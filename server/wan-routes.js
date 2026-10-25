const express = require('express');
const crypto = require('node:crypto');
const { MODEL, ServiceError, validateInput } = require('./wan-provider');
const { publicVideoUrl } = require('./public-video');
const { WalletError } = require('./api-wallet');
const { createGenerationLogger, describeError } = require('./generation-log');
const { MODELS, MODEL_IDS, ACTIVE_MODEL_IDS, isManagedVideoModel } = require('./video-models');

const UNCERTAIN = 'Pengiriman belum terkonfirmasi. Jangan kirim ulang; simpan taskId dan hubungi dukungan Xclip.';
const UPSCALE_UNCERTAIN = 'Peningkatan kualitas belum terkonfirmasi. Simpan taskId dan hubungi dukungan Xclip; jangan mengirim request generasi baru.';
const STATUS_UNAVAILABLE = 'Pengecekan hasil sedang terkendala. Status terakhir belum memastikan hasil generasi. Simpan taskId, cek lagi dalam 30 detik, dan jangan generate ulang. Jika berlanjut, hubungi dukungan Xclip.';
function requestReference(res) {
  const requestId = res.get('X-Xclip-Request-Id') || crypto.randomUUID();
  res.set('X-Xclip-Request-Id', requestId);
  return requestId;
}
function taskResponse(row) {
  return { success: row.status !== 'failed', taskId: row.task_id, model: row.model,
    status: row.status, createdAt: row.created_at,
    ...(row.retry_data?.upscale?.required && !['completed','failed'].includes(row.status)
      ? { stage: row.retry_data.upscale.phase === 'waiting_source' ? 'generating' : 'upscaling' } : {}),
    ...(row.status === 'processing' && ['submitting','uncertain'].includes(row.retry_data?.upscale?.phase)
      ? { notice: UPSCALE_UNCERTAIN } : {}),
    videoUrl: row.status === 'completed' && row.video_url ? publicVideoUrl(row.task_id) : null,
    ...(row.status === 'failed' ? { error: 'Generasi video gagal.' } : {}),
    ...(row.status === 'pending' && !row.retry_data?.runId ? { notice: UNCERTAIN } : {}) };
}
function sendError(res, error) {
  const known = error instanceof ServiceError || error instanceof WalletError;
  const status = known ? error.status : 503;
  const codes = { 400:'INVALID_REQUEST', 401:'AUTH_REQUIRED', 402:'INSUFFICIENT_BALANCE',
    403:'ACCESS_DENIED', 404:'TASK_NOT_FOUND', 409:'REQUEST_CONFLICT',
    410:'MODEL_RETIRED', 429:'REQUEST_LIMIT', 503:'SERVICE_UNAVAILABLE' };
  return res.status(status).json({
    error: known ? error.message : 'Layanan Xclip sementara tidak tersedia.',
    code: codes[status] || 'SERVICE_UNAVAILABLE', requestId: requestReference(res),
  });
}

module.exports = function wanRoutes({ pool, provider, providers = {}, wallet, upscaler, validateKey, saveImage, cooldownMs = 180000, dailyQuota = 50,
  statusRetryMs = 20000,
  logger = createGenerationLogger() }) {
  const adapters = { [MODEL]: provider, ...providers };
  function adapter(model) {
    if (!isManagedVideoModel(model) || !adapters[model]) throw new ServiceError(503, 'Layanan model sementara tidak tersedia.');
    return adapters[model];
  }
  const router = express.Router();
  const polling = new Map();
  function responseWithDiagnostics(row) {
    const data = taskResponse(row);
    if (['pending', 'processing'].includes(row.status)) {
      const failure = polling.get(row.task_id)?.failure;
      if (failure) {
        data.statusCheck = { state: 'unavailable', checkedAt: failure };
        data.notice = STATUS_UNAVAILABLE;
      } else if (Date.now() - new Date(row.created_at).getTime() > 30 * 60 * 1000) {
        data.notice = data.notice || 'Generasi memerlukan pemeriksaan karena sudah lebih dari 30 menit. Simpan taskId dan hubungi dukungan Xclip; jangan generate ulang.';
      }
    }
    return data;
  }
  let reconciling = false;
  logger.info('routes_ready');
  async function pollTask(row) {
    let entry = polling.get(row.task_id);
    if (!entry || !entry.pending && entry.until < Date.now()) {
      const promise = (async () => {
        const started=Date.now();
        let stage='poll_upstream';
        logger.info('task_poll_started',{taskId:row.task_id,status:row.status});
        try {
          let result = row.retry_data?.upscale?.sourceUrl ? null : await adapter(row.model).poll(row.retry_data);
          if (row.retry_data?.upscale?.required) {
            if (!upscaler) throw new ServiceError(503, 'Peningkatan kualitas video belum tersedia.');
            stage = 'upscale';
            result = await upscaler.process(row, result);
          }
          stage='persist_task_status';
          if (!wallet) throw new ServiceError(503, 'Penyelesaian task belum tersedia.');
          const updated=await wallet.finish(row, result);
          const terminal=['completed','failed'].includes(updated.status);
          const fields={taskId:row.task_id,status:updated.status,billing:row.retry_data?.billing,
            elapsedMs:Date.now()-started,progress:result.progress,
            ...(row.retry_data?.billing==='wallet'?{walletState:updated.status==='failed'?'refunded':
              updated.status==='completed'?'spent':'held'}:{}),
            ageSeconds:Math.max(0,Math.floor((Date.now()-new Date(row.created_at).getTime())/1000)),
            ...(updated.status==='failed'?{reason:result.failureReason||'upstream_generation_failed'}:{})};
          logger[updated.status==='failed'?'error':'info'](terminal?'task_'+updated.status:'task_in_progress',fields);
          return updated;
        } catch (error) {
          logger.error('task_poll_failed',{taskId:row.task_id,stage,elapsedMs:Date.now()-started,...describeError(error)});
          if (stage === 'poll_upstream' || stage === 'upscale') {
            error.statusCheckUnavailable = true;
          }
          throw error;
        }
      })();
      entry = { promise, pending: true, until: Date.now() + 25000 };
      polling.set(row.task_id, entry);
      promise.then(() => { entry.pending = false; entry.until = Date.now() + 5000; }, () => {
        entry.pending = false;
        entry.failure = new Date().toISOString();
        entry.until = Date.now() + statusRetryMs;
      });
      for (const [id, old] of polling) if (!old.pending && old.until < Date.now()) polling.delete(id);
    }
    return entry.promise;
  }
  router.reconcile = async () => {
    if (reconciling) {
      logger.info('worker_heartbeat',{stage:'worker_busy'});return;
    }
    if (!wallet) {
      logger.warn('worker_unavailable',{reason:'wallet_not_ready'});return;
    }
    try { wallet.assertReady(); } catch {
      logger.warn('worker_unavailable',{reason:'wallet_not_ready'});return;
    }
    reconciling = true;
    logger.info('worker_tick');
    const started=Date.now();
    let checkedTasks=0,failedChecks=0;
    try {
      const { rows } = await pool.query(`SELECT * FROM video_generation_tasks WHERE model = ANY($1::text[])
        AND status IN ('pending','processing') AND retry_data->>'runId' IS NOT NULL
        ORDER BY created_at LIMIT 20`, [MODEL_IDS]);
      checkedTasks=rows.length;
      for (const row of rows) await pollTask(row).catch(() => { failedChecks++; });
    } catch (error) {
      failedChecks++;
      logger.error('worker_failed',{stage:'load_pending_tasks',...describeError(error)});
    }
    finally {
      logger.info('worker_heartbeat',{checkedTasks,failedChecks,elapsedMs:Date.now()-started});
      reconciling = false;
    }
  };
  async function owner(req) {
    if (req.headers['x-xclip-key']) {
      const key = await validateKey(req.headers['x-xclip-key']);
      if (!key) throw new ServiceError(401, 'Xclip API key tidak valid atau sudah tidak aktif.');
      return { column: 'xclip_api_key_id', id: key.id, key };
    }
    if (req.session?.userId) return { column: 'user_id', id: req.session.userId };
    throw new ServiceError(401, 'Login atau Xclip API key diperlukan.');
  }
  // Read-only history: never dispatch or poll upstream as a side effect of listing.
  router.get('/api/developer/generations', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    requestReference(res);
    try {
      const auth = await owner(req);
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
        throw new ServiceError(400, 'Halaman riwayat tidak valid.');
      }
      const { rows } = await pool.query(
        `SELECT task_id, model, status, created_at, completed_at,
          CASE WHEN status = 'completed' AND video_url IS NOT NULL THEN TRUE ELSE FALSE END AS has_video,
          retry_data->>'delivery' AS delivery,
          CASE WHEN retry_data->'upscale'->>'required' = 'true' AND status IN ('pending','processing')
            THEN CASE WHEN retry_data->'upscale'->>'phase' = 'waiting_source'
              THEN 'generating' ELSE 'upscaling' END END AS stage,
          retry_data->'upscale'->>'phase' AS upscale_phase
         FROM video_generation_tasks WHERE ${auth.column} = $1 AND model = ANY($2::text[])
         ORDER BY created_at DESC, task_id DESC LIMIT 21 OFFSET $3`,
        [auth.id, MODEL_IDS, (page - 1) * 20]);
      const tasks = rows.slice(0, 20).map(row => ({
        taskId: row.task_id, model: row.model, status: row.status,
        createdAt: row.created_at, completedAt: row.completed_at,
        videoUrl: row.status === 'completed' && row.has_video ? publicVideoUrl(row.task_id) : null,
        ...(['generating','upscaling'].includes(row.stage) ? { stage: row.stage } : {}),
        ...(row.status === 'processing' && ['submitting','uncertain'].includes(row.upscale_phase)
          ? { notice: UPSCALE_UNCERTAIN } : {}),
        ...(row.status === 'failed' ? { error: 'Generasi video gagal. Jika memakai saldo API, saldo dikembalikan setelah kegagalan dikonfirmasi.' } : {}),
        ...(row.status === 'pending' && row.delivery !== 'confirmed' ? { notice: UNCERTAIN } : {}),
        ...(['pending','processing'].includes(row.status) && polling.get(row.task_id)?.failure
          ? { statusCheck: { state: 'unavailable', checkedAt: polling.get(row.task_id).failure }, notice: STATUS_UNAVAILABLE }
          : ['pending','processing'].includes(row.status) &&
            !(row.status === 'pending' && row.delivery !== 'confirmed') &&
            !(row.status === 'processing' && ['submitting','uncertain'].includes(row.upscale_phase)) &&
            Date.now() - new Date(row.created_at).getTime() > 30 * 60 * 1000
            ? { notice: 'Generasi memerlukan pemeriksaan karena sudah lebih dari 30 menit. Simpan taskId dan hubungi dukungan Xclip; jangan generate ulang.' } : {}),
      }));
      res.json({ tasks, page, hasMore: rows.length > 20 });
    } catch (error) {
      logger.warn('history_request_failed', describeError(error));
      sendError(res, error);
    }
  });
  router.get('/api/developer/models', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    requestReference(res);
    try {
      await owner(req);
      const models = await Promise.all(ACTIVE_MODEL_IDS.map(async id => {
        let status = 'available';
        try {
          await adapter(id).context();
          if (MODELS[id].upscale) {
            if (!upscaler) throw new ServiceError(503, 'Peningkatan kualitas video belum tersedia.');
            await upscaler.context(MODELS[id].maxDuration);
          }
        }
        catch (error) {
          status = 'unavailable';
          logger.warn('catalog_failed', { stage: 'load_model_catalog', ...describeError(error) });
        }
        const { generationResolution, upscale, retired, ...publicSpec } = MODELS[id];
        return { ...publicSpec, status, modes: ['text-to-video', 'image-to-video'],
          ...(upscale ? { outputProcessing: 'upscaled' } : {}),
          resolution: MODELS[id].resolution || '480p', defaultDuration: MODELS[id].maxDuration, currency: 'IDR' };
      }));
      res.json({ models });
    } catch (error) {
      logger.warn('catalog_failed',{stage:'load_model_catalog',...describeError(error)});
      sendError(res, error);
    }
  });

  router.post('/api/videogen/proxy', async (req, res, next) => {
    if (!isManagedVideoModel(req.body?.model) &&
        !/^(?:wan[-_\s]?3|seedance[-_\s]?2)/i.test(String(req.body?.model || ''))) return next();
    res.set('Cache-Control', 'private, no-store');
    let client, locked = false, quotaKeyId = null, quotaNamespace;
    let userId,taskId,stage='authenticate';
    const requestId=crypto.randomUUID(),started=Date.now();
    res.set('X-Xclip-Request-Id',requestId);
    logger.info('request_received',{requestId});
    try {
      const auth = await owner(req);
      if (!auth.key) throw new ServiceError(401, 'Gunakan header X-Xclip-Key untuk generasi.');
      const key = auth.key;
      userId = key.user_id;
      stage='validate_request';
      const input = validateInput(req.body);
      const service = adapter(input.model);
      const price = MODELS[input.model].pricePerVideo;
      const idem = req.headers['idempotency-key'];
      if (typeof idem !== 'string' || !/^[\w.-]{1,128}$/.test(idem)) {
        throw new ServiceError(400, 'Idempotency-Key unik wajib diisi untuk setiap request baru.');
      }
      taskId = 'xv_' + crypto.createHash('sha256').update(`${key.id}:${idem}`).digest('hex');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
      stage='check_request_limits';
      client = await pool.connect();
      // A session lock serializes requests across processes without a long DB transaction.
      await client.query('SELECT pg_advisory_lock($1, $2)', [73203, userId]);
      locked = true;
      const existing = (await client.query(
        'SELECT * FROM video_generation_tasks WHERE task_id = $1 AND xclip_api_key_id = $2',
        [taskId, key.id])).rows[0];
      if (existing) {
        if (existing.retry_data?.fingerprint !== fingerprint) {
          throw new ServiceError(409, 'Idempotency-Key telah dipakai untuk request yang berbeda.');
        }
        logger.info('request_replayed',{requestId,taskId,status:existing.status});
        return res.status(200).json(taskResponse(existing));
      }
      const uncertain = await client.query(
        `SELECT task_id FROM video_generation_tasks WHERE user_id = $1 AND model = ANY($2::text[])
         AND status = 'pending' AND retry_data->>'delivery' = 'unconfirmed' LIMIT 1`, [userId, MODEL_IDS]);
      if (uncertain.rows.length) throw new ServiceError(409, UNCERTAIN);
      const recent = await client.query(
        `SELECT task_id FROM video_generation_tasks WHERE user_id = $1
         AND created_at > NOW() - ($2 * INTERVAL '1 millisecond') LIMIT 1`, [userId, cooldownMs]);
      if (recent.rows.length) throw new ServiceError(429, `Tunggu ${Math.ceil(cooldownMs / 1000)} detik sebelum request baru.`);

      // Fail early for empty wallets, before uploads, quotes or backend credential access.
      // Reservation below remains authoritative and atomic; this check never grants credit.
      const billable = input.model !== MODEL || !key.has_subscription;
      if (billable) {
        stage = 'check_wallet';
        if (!wallet) throw new ServiceError(503, 'Saldo API belum tersedia.');
        const balance = await wallet.get(userId);
        if (balance.balance < price) throw new WalletError(402,
          `Saldo API tidak cukup. Biaya video ini Rp${price.toLocaleString('id-ID')}. Isi saldo API melalui menu Top up; API key aktif dan langganan lama bukan saldo API.`);
      }
      // Check account/model metadata before accepting or storing any paid request.
      stage='prepare_generation';
      let upscale;
      if (MODELS[input.model].upscale) {
        if (!upscaler) throw new ServiceError(503, 'Peningkatan kualitas video belum tersedia.');
        upscale = await upscaler.prepare(input.duration);
      }
      await service.context();
      const imageUrl = input.image && !service.handlesImage ? await saveImage(input.image, req) : undefined;
      const prepared = await service.prepare(input, imageUrl);
      quotaNamespace = input.model === MODEL ? 73204 : 73205;
      await client.query('SELECT pg_advisory_lock($1, $2)', [quotaNamespace, prepared.keyId]);
      quotaKeyId = prepared.keyId;
      const usage = await client.query(
        `SELECT COUNT(*)::int AS count FROM video_generation_tasks WHERE model = ANY($1::text[])
         AND created_at >= date_trunc('day', NOW()) AND retry_data->>'keyId' = $2
         AND (retry_data->>'delivery' = 'confirmed' OR status = 'pending')`,
        [input.model === MODEL ? [MODEL] : MODEL_IDS.filter(id => id !== MODEL), String(prepared.keyId)]);
      if (usage.rows[0].count >= dailyQuota) throw new ServiceError(429, 'Kuota layanan hari ini telah tercapai.');
      // Honor already-purchased active legacy access; new top ups never extend it.
      const meta = { source: input.model === MODEL ? 'wan' : 'picsart-video', keyId: prepared.keyId, fingerprint, delivery: 'unconfirmed',
        ...(upscale ? { upscale } : {}),
        billing: billable ? 'wallet' : 'legacy', ...(billable ? { price } : {}) };
      let row;
      stage='reserve_and_save_task';
      await client.query('BEGIN');
      try {
        if (billable) await wallet.reserve(client, userId, taskId, price);
        row = (await client.query(`INSERT INTO video_generation_tasks
         (task_id, xclip_api_key_id, user_id, room_id, model, status, retry_data)
         VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING *`,
        [taskId, key.id, userId, key.room_id, input.model, JSON.stringify(meta)])).rows[0];
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      logger.info('task_queued',{requestId,taskId,status:'pending',billing:meta.billing,
        amount:billable?price:0,duration:input.duration});
      try {
        stage='dispatch_generation';
        logger.info('generation_dispatch_started',{requestId,taskId});
        meta.runId = await service.start(prepared, taskId);
        meta.delivery = 'confirmed';
        stage='save_dispatch_result';
        await client.query(
          "UPDATE video_generation_tasks SET status = 'processing', retry_data = $1 WHERE task_id = $2 AND xclip_api_key_id = $3",
          [JSON.stringify(meta), taskId, key.id]);
        row.status = 'processing';
        row.retry_data = meta;
        logger.info('generation_accepted',{requestId,taskId,status:'processing',elapsedMs:Date.now()-started});
        await client.query(
          'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = NOW() WHERE id = $1', [key.id]);
      } catch (error) {
        // Preserve an uncertain delivery for manual reconciliation, never rerun it.
        if (error.deliveryUncertain || meta.runId) {
          logger.warn('generation_delivery_uncertain',{requestId,taskId,stage,...describeError(error)});
          return res.status(202).json(taskResponse(row));
        }
        logger.error('generation_dispatch_failed',{requestId,taskId,stage,...describeError(error)});
        stage='settle_failed_task';
        if (!wallet) throw new ServiceError(503, 'Penyelesaian task belum tersedia.');
        await wallet.finish(row, { status: 'failed', videoUrl: null }, client);
        logger.error('task_failed',{requestId,taskId,status:'failed',billing:meta.billing,
          reason:'upstream_generation_failed'});
        if (billable) logger.info('wallet_reservation_refunded',{requestId,taskId,amount:price});
        throw error;
      }
      res.status(202).json(taskResponse(row));
    } catch (error) {
      const rejected=(error instanceof ServiceError || error instanceof WalletError) && error.status<500;
      logger[rejected?'warn':'error']('request_failed',{requestId,taskId,stage,
        httpStatus:error instanceof ServiceError || error instanceof WalletError ? error.status : 503,
        elapsedMs:Date.now()-started,...describeError(error)});
      sendError(res, error);
    }
    finally {
      if (client) {
        let destroy = false;
        try {
          if (quotaKeyId != null) await client.query('SELECT pg_advisory_unlock($1, $2)', [quotaNamespace, quotaKeyId]);
          if (locked) await client.query('SELECT pg_advisory_unlock($1, $2)', [73203, userId]);
        }
        catch (error) {
          destroy = true;
          logger.error('request_lock_cleanup_failed',{requestId,taskId,...describeError(error)});
        }
        finally { client.release(destroy); }
      }
    }
  });

  router.get('/api/videogen/tasks/:taskId', async (req, res, next) => {
    if (!req.params.taskId.startsWith('xv_')) return next();
    res.set('Cache-Control', 'private, no-store');
    const requestId = requestReference(res);
    try {
      const auth = await owner(req);
      const row = (await pool.query(
        `SELECT * FROM video_generation_tasks WHERE task_id = $1 AND ${auth.column} = $2 AND model = ANY($3::text[])`,
        [req.params.taskId, auth.id, MODEL_IDS])).rows[0];
      if (!row) throw new ServiceError(404, 'Task tidak ditemukan.');
      if (['completed', 'failed'].includes(row.status) || !row.retry_data?.runId) {
        logger.info('task_status_read',{taskId:row.task_id,status:row.status});
        return res.json(responseWithDiagnostics(row));
      }
      try {
        res.json(responseWithDiagnostics(await pollTask(row)));
      } catch (error) {
        if (!error.statusCheckUnavailable) throw error;
        res.set('Retry-After', '30');
        res.json({ ...responseWithDiagnostics(row), requestId });
      }
    } catch (error) {
      logger.warn('status_request_failed',{requestId,taskId:req.params.taskId,...describeError(error)});
      sendError(res, error);
    }
  });
  return router;
};

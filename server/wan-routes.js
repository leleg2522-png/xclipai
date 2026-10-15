const express = require('express');
const crypto = require('node:crypto');
const { MODEL, ServiceError, validateInput } = require('./wan-provider');
const { publicVideoUrl } = require('./public-video');
const { WalletError, VIDEO_PRICE } = require('./api-wallet');
const { createGenerationLogger, describeError } = require('./generation-log');

const UNCERTAIN = 'Pengiriman belum terkonfirmasi. Jangan kirim ulang; simpan taskId dan hubungi dukungan Xclip.';
function taskResponse(row) {
  return { success: row.status !== 'failed', taskId: row.task_id, model: MODEL,
    status: row.status, createdAt: row.created_at,
    videoUrl: row.status === 'completed' && row.video_url ? publicVideoUrl(row.task_id) : null,
    ...(row.status === 'failed' ? { error: 'Generasi video gagal.' } : {}),
    ...(row.status === 'pending' && !row.retry_data?.runId ? { notice: UNCERTAIN } : {}) };
}
function sendError(res, error) {
  const known = error instanceof ServiceError || error instanceof WalletError;
  return res.status(known ? error.status : 503)
    .json({ error: known ? error.message : 'Layanan Xclip sementara tidak tersedia.' });
}

module.exports = function wanRoutes({ pool, provider, wallet, validateKey, saveImage, cooldownMs = 180000, dailyQuota = 50,
  logger = createGenerationLogger() }) {
  const router = express.Router();
  const polling = new Map();
  let reconciling = false;
  logger.info('routes_ready');
  async function pollTask(row) {
    let entry = polling.get(row.task_id);
    if (!entry || entry.until < Date.now()) {
      const promise = (async () => {
        const started=Date.now();
        let stage='poll_upstream';
        logger.info('task_poll_started',{taskId:row.task_id,status:row.status});
        try {
          const result = await provider.poll(row.retry_data);
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
          throw error;
        }
      })();
      entry = { promise, until: Date.now() + 25000 };
      polling.set(row.task_id, entry);
      promise.then(() => { entry.until = Date.now() + 5000; }, () => {
        if (polling.get(row.task_id) === entry) polling.delete(row.task_id);
      });
      for (const [id, old] of polling) if (old.until < Date.now()) polling.delete(id);
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
      const { rows } = await pool.query(`SELECT * FROM video_generation_tasks WHERE model = $1
        AND status IN ('pending','processing') AND retry_data->>'runId' IS NOT NULL
        ORDER BY created_at LIMIT 20`, [MODEL]);
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
    try {
      const auth = await owner(req);
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
        throw new ServiceError(400, 'Halaman riwayat tidak valid.');
      }
      const { rows } = await pool.query(
        `SELECT task_id, model, status, created_at, completed_at,
          CASE WHEN status = 'completed' AND video_url IS NOT NULL THEN TRUE ELSE FALSE END AS has_video,
          retry_data->>'delivery' AS delivery
         FROM video_generation_tasks WHERE ${auth.column} = $1 AND model = $2
         ORDER BY created_at DESC, task_id DESC LIMIT 21 OFFSET $3`,
        [auth.id, MODEL, (page - 1) * 20]);
      const tasks = rows.slice(0, 20).map(row => ({
        taskId: row.task_id, model: MODEL, status: row.status,
        createdAt: row.created_at, completedAt: row.completed_at,
        videoUrl: row.status === 'completed' && row.has_video ? publicVideoUrl(row.task_id) : null,
        ...(row.status === 'failed' ? { error: 'Generasi video gagal. Jika memakai saldo API, saldo dikembalikan setelah kegagalan dikonfirmasi.' } : {}),
        ...(row.status === 'pending' && row.delivery !== 'confirmed' ? { notice: UNCERTAIN } : {}),
      }));
      res.json({ tasks, page, hasMore: rows.length > 20 });
    } catch (error) {
      logger.warn('history_request_failed', describeError(error));
      sendError(res, error);
    }
  });
  router.get('/api/developer/models', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      await owner(req);
      await provider.context();
      res.json({ models: [{ id: MODEL, name: 'Wan 3.0 Uncensored', category: 'Video · Uncensored',
        status: 'available', modes: ['text-to-video', 'image-to-video'], resolution: '480p',
        defaultDuration: 30, minDuration: 2, maxDuration: 30, pricePerVideo: VIDEO_PRICE, currency: 'IDR' }] });
    } catch (error) {
      logger.warn('catalog_failed',{stage:'load_model_catalog',...describeError(error)});
      sendError(res, error);
    }
  });

  router.post('/api/videogen/proxy', async (req, res, next) => {
    if (!/^wan[-_\s]?3/i.test(String(req.body?.model || ''))) return next();
    res.set('Cache-Control', 'private, no-store');
    let client, locked = false, quotaKeyId = null;
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
        `SELECT task_id FROM video_generation_tasks WHERE user_id = $1 AND model = $2
         AND status = 'pending' AND retry_data->>'delivery' = 'unconfirmed' LIMIT 1`, [userId, MODEL]);
      if (uncertain.rows.length) throw new ServiceError(409, UNCERTAIN);
      const recent = await client.query(
        `SELECT task_id FROM video_generation_tasks WHERE user_id = $1
         AND created_at > NOW() - ($2 * INTERVAL '1 millisecond') LIMIT 1`, [userId, cooldownMs]);
      if (recent.rows.length) throw new ServiceError(429, `Tunggu ${Math.ceil(cooldownMs / 1000)} detik sebelum request baru.`);

      // Check account/model metadata before accepting or storing any paid request.
      stage='prepare_generation';
      await provider.context();
      const imageUrl = input.image ? await saveImage(input.image, req) : undefined;
      const prepared = await provider.prepare(input, imageUrl);
      await client.query('SELECT pg_advisory_lock($1, $2)', [73204, prepared.keyId]);
      quotaKeyId = prepared.keyId;
      const usage = await client.query(
        `SELECT COUNT(*)::int AS count FROM video_generation_tasks WHERE model = $1
         AND created_at >= date_trunc('day', NOW()) AND retry_data->>'keyId' = $2
         AND (retry_data->>'delivery' = 'confirmed' OR status = 'pending')`, [MODEL, String(prepared.keyId)]);
      if (usage.rows[0].count >= dailyQuota) throw new ServiceError(429, 'Kuota layanan hari ini telah tercapai.');
      // Honor already-purchased active legacy access; new top ups never extend it.
      const billable = !key.has_subscription;
      if (billable && !wallet) throw new ServiceError(503, 'Saldo API belum tersedia.');
      const meta = { source: 'wan', keyId: prepared.keyId, fingerprint, delivery: 'unconfirmed',
        billing: billable ? 'wallet' : 'legacy', ...(billable ? { price: VIDEO_PRICE } : {}) };
      let row;
      stage='reserve_and_save_task';
      await client.query('BEGIN');
      try {
        if (billable) await wallet.reserve(client, userId, taskId);
        row = (await client.query(`INSERT INTO video_generation_tasks
         (task_id, xclip_api_key_id, user_id, room_id, model, status, retry_data)
         VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING *`,
        [taskId, key.id, userId, key.room_id, MODEL, JSON.stringify(meta)])).rows[0];
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      logger.info('task_queued',{requestId,taskId,status:'pending',billing:meta.billing,
        amount:billable?VIDEO_PRICE:0,duration:input.duration});
      try {
        stage='dispatch_generation';
        logger.info('generation_dispatch_started',{requestId,taskId});
        meta.runId = await provider.start(prepared, taskId);
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
        if (billable) logger.info('wallet_reservation_refunded',{requestId,taskId,amount:VIDEO_PRICE});
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
          if (quotaKeyId != null) await client.query('SELECT pg_advisory_unlock($1, $2)', [73204, quotaKeyId]);
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
    try {
      const auth = await owner(req);
      const row = (await pool.query(
        `SELECT * FROM video_generation_tasks WHERE task_id = $1 AND ${auth.column} = $2 AND model = $3`,
        [req.params.taskId, auth.id, MODEL])).rows[0];
      if (!row) throw new ServiceError(404, 'Task tidak ditemukan.');
      if (['completed', 'failed'].includes(row.status) || !row.retry_data?.runId) {
        logger.info('task_status_read',{taskId:row.task_id,status:row.status});
        return res.json(taskResponse(row));
      }
      res.json(taskResponse(await pollTask(row)));
    } catch (error) {
      logger.warn('status_request_failed',{taskId:req.params.taskId,...describeError(error)});
      sendError(res, error);
    }
  });
  return router;
};

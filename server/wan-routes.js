const express = require('express');
const crypto = require('node:crypto');
const { MODEL, ServiceError, validateInput } = require('./wan-provider');
const { publicVideoUrl } = require('./public-video');
const { WalletError, VIDEO_PRICE } = require('./api-wallet');

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

module.exports = function wanRoutes({ pool, provider, wallet, validateKey, saveImage, cooldownMs = 180000, dailyQuota = 50 }) {
  const router = express.Router();
  const polling = new Map();
  let reconciling = false;
  async function pollTask(row) {
    let entry = polling.get(row.task_id);
    if (!entry || entry.until < Date.now()) {
      const promise = (async () => {
        const result = await provider.poll(row.retry_data);
        if (!wallet) throw new ServiceError(503, 'Penyelesaian task belum tersedia.');
        return wallet.finish(row, result);
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
    if (reconciling || !wallet) return;
    try { wallet.assertReady(); } catch { return; }
    reconciling = true;
    try {
      const { rows } = await pool.query(`SELECT * FROM video_generation_tasks WHERE model = $1
        AND status IN ('pending','processing') AND retry_data->>'runId' IS NOT NULL
        ORDER BY created_at LIMIT 20`, [MODEL]);
      for (const row of rows) await pollTask(row).catch(() => {});
    } catch (error) { console.warn('Xclip task reconciliation unavailable:', error.code || error.name); }
    finally { reconciling = false; }
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
  router.get('/api/developer/models', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      await owner(req);
      await provider.context();
      res.json({ models: [{ id: MODEL, name: 'Wan 3.0 Uncensored', category: 'Video · Uncensored',
        status: 'available', modes: ['text-to-video', 'image-to-video'], resolution: '480p',
        defaultDuration: 30, minDuration: 2, maxDuration: 30, pricePerVideo: VIDEO_PRICE, currency: 'IDR' }] });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/videogen/proxy', async (req, res, next) => {
    if (!/^wan[-_\s]?3/i.test(String(req.body?.model || ''))) return next();
    res.set('Cache-Control', 'private, no-store');
    let client, locked = false, quotaKeyId = null;
    let userId;
    try {
      const auth = await owner(req);
      if (!auth.key) throw new ServiceError(401, 'Gunakan header X-Xclip-Key untuk generasi.');
      const key = auth.key;
      userId = key.user_id;
      const input = validateInput(req.body);
      const idem = req.headers['idempotency-key'];
      if (typeof idem !== 'string' || !/^[\w.-]{1,128}$/.test(idem)) {
        throw new ServiceError(400, 'Idempotency-Key unik wajib diisi untuk setiap request baru.');
      }
      const taskId = 'xv_' + crypto.createHash('sha256').update(`${key.id}:${idem}`).digest('hex');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
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
      try {
        meta.runId = await provider.start(prepared, taskId);
        meta.delivery = 'confirmed';
        await client.query(
          "UPDATE video_generation_tasks SET status = 'processing', retry_data = $1 WHERE task_id = $2 AND xclip_api_key_id = $3",
          [JSON.stringify(meta), taskId, key.id]);
        row.status = 'processing';
        row.retry_data = meta;
        await client.query(
          'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = NOW() WHERE id = $1', [key.id]);
      } catch (error) {
        // Preserve an uncertain delivery for manual reconciliation, never rerun it.
        if (error.deliveryUncertain || meta.runId) return res.status(202).json(taskResponse(row));
        if (!wallet) throw new ServiceError(503, 'Penyelesaian task belum tersedia.');
        await wallet.finish(row, { status: 'failed', videoUrl: null }, client);
        throw error;
      }
      res.status(202).json(taskResponse(row));
    } catch (error) { sendError(res, error); }
    finally {
      if (client) {
        let destroy = false;
        try {
          if (quotaKeyId != null) await client.query('SELECT pg_advisory_unlock($1, $2)', [73204, quotaKeyId]);
          if (locked) await client.query('SELECT pg_advisory_unlock($1, $2)', [73203, userId]);
        }
        catch { destroy = true; console.error('Xclip request lock cleanup failed'); }
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
        return res.json(taskResponse(row));
      }
      res.json(taskResponse(await pollTask(row)));
    } catch (error) { sendError(res, error); }
  });
  return router;
};

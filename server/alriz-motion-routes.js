const express = require('express');
const crypto = require('node:crypto');
const { MotionError } = require('./alriz-motion-provider');
const { checkedUrl, streamVideo } = require('./public-video');
const { createGenerationLogger, describeError } = require('./generation-log');

const MARKER = 'alriz-motion';
const PUBLIC_MODEL = 'kling-v2.6-pro';
const UNCERTAIN = 'Pengiriman belum terkonfirmasi. Jangan buat ulang; simpan taskId dan hubungi admin Xclip.';
const videoPath = id => `/api/motion/tasks/${encodeURIComponent(id)}/video`;
const isOurs = row => row?.retry_data?.provider === MARKER;
function publicMotion(row) {
  return { success: row.status !== 'failed', taskId: row.task_id, model: PUBLIC_MODEL,
    status: row.status, progress: row.status === 'completed' ? 100 : row.status === 'processing' ? 30 : 0,
    createdAt: row.created_at,
    ...(row.status === 'completed' ? { videoUrl: videoPath(row.task_id) } : {}),
    ...(row.status === 'failed' ? { error: 'Generasi motion control gagal.' } : {}),
    ...(row.status === 'pending' ? { notice: UNCERTAIN } : {}) };
}
function validateInput(body) {
  if (body.model && ![PUBLIC_MODEL, 'mc-kling-2.6-pro', 'motion-kling-v2.6-pro'].includes(body.model)) {
    throw new MotionError(400, 'Motion Control sekarang menggunakan Kling MC 2.6 Pro. Gunakan model kling-v2.6-pro.');
  }
  if (body.characterOrientation && body.characterOrientation !== 'video') {
    throw new MotionError(400, 'Orientasi karakter khusus belum didukung. Gunakan orientasi video.');
  }
  for (const [field, kind] of [['characterImage', 'image'], ['referenceVideo', 'video']]) {
    const value = body[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw new MotionError(400, kind === 'image' ? 'Gambar karakter diperlukan.' : 'Video referensi diperlukan.');
    }
    if (/^https:\/\//i.test(value)) {
      try { checkedUrl(value); } catch { throw new MotionError(400, 'URL referensi tidak valid.'); }
    } else {
      const formats = kind === 'image' ? '(?:png|jpeg|webp)' : '(?:mp4|quicktime)';
      if (!new RegExp(`^data:${kind}/${formats};base64,[A-Za-z0-9+/]+={0,2}$`).test(value) &&
          !/^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new MotionError(400, 'Gunakan URL HTTPS atau data URI gambar JPG/PNG/WebP dan video MP4/MOV.');
      }
    }
  }
  if (body.prompt != null && (typeof body.prompt !== 'string' || body.prompt.length > 5000)) {
    throw new MotionError(400, 'Prompt maksimal 5000 karakter.');
  }
  const roomId = body.roomId == null ? 1 : Number(body.roomId);
  if (!Number.isSafeInteger(roomId) || roomId < 1) throw new MotionError(400, 'Room tidak valid.');
  return roomId;
}

module.exports = function alrizMotionRoutes({ pool, provider, validateKey, saveFile,
  getCooldown = () => 0, setCooldown = () => {}, cooldownMs = 180000,
  logger = createGenerationLogger(), stream = streamVideo }) {
  const router = express.Router();
  const polls = new Map();
  const inFlight = new Set();
  let reconciling = false;
  function report(event, row, error) {
    const fields = { taskId: row?.task_id, status: row?.status, stage: 'motion_control',
      ...(error ? describeError(error) : {}) };
    logger[error ? 'error' : 'info'](event, fields);
  }
  function sendError(res, error, row) {
    report('motion_request_failed', row, error);
    return res.status(error instanceof MotionError ? error.status : 503).json({
      error: error instanceof MotionError ? error.message : 'Layanan motion control sementara tidak tersedia.',
      ...(row ? { taskId: row.task_id } : {}),
    });
  }
  async function authenticate(req, allowSession = false) {
    const key = req.headers['x-xclip-key'];
    if (key) {
      const user = await validateKey(key);
      if (!user) throw new MotionError(401, 'Xclip API key tidak valid.');
      return { column: 'xclip_api_key_id', id: user.id, user };
    }
    if (allowSession && req.session?.userId) return { column: 'user_id', id: req.session.userId };
    throw new MotionError(401, 'Xclip API key diperlukan.');
  }
  async function poll(row) {
    if (!isOurs(row) || !row.retry_data.jobId || ['completed', 'failed'].includes(row.status)) return row;
    const cached = polls.get(row.task_id);
    if (cached && cached.until > Date.now()) return cached.promise;
    // Bound in-memory cache size; no credentials are retained here.
    for (const [id, old] of polls) if (old.until <= Date.now()) polls.delete(id);
    const promise = (async () => {
      report('motion_poll_started', row);
      const result = await provider.poll(row.retry_data.jobId);
      const data = { ...row.retry_data, lastPollAt: new Date().toISOString(),
        ...(result.videoUrl ? { resultUrl: result.videoUrl } : {}) };
      const updated = await pool.query(`UPDATE video_generation_tasks SET status = $2::text,
        video_url = $3, error_message = $4, retry_data = $5::jsonb,
        completed_at = CASE WHEN $2::text IN ('completed','failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE task_id = $1 AND status IN ('pending','processing') RETURNING *`,
      [row.task_id, result.status, result.status === 'completed' ? videoPath(row.task_id) : null,
        result.status === 'failed' ? 'Generasi motion control gagal.' : null, JSON.stringify(data)]);
      const saved = updated.rows[0] || row;
      report(result.status === 'processing' ? 'motion_in_progress' : 'motion_' + result.status, saved);
      return saved;
    })();
    polls.set(row.task_id, { promise, until: Date.now() + 25000 });
    try { return await promise; } catch (error) {
      polls.delete(row.task_id);
      report('motion_poll_failed', row, error);
      throw error;
    }
  }

  // This route handles all NEW motion submissions. It never falls through to
  // the legacy Freepik submit handler, even when Alriz is unavailable.
  router.post('/generate', async (req, res) => {
    let row, submitted = false, lockedUser, ownsReservation = false;
    try {
      const auth = await authenticate(req);
      const roomId = validateInput(req.body);
      const idem = req.headers['idempotency-key'];
      if (idem && (typeof idem !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(idem))) {
        throw new MotionError(400, 'Idempotency-Key harus 8–120 karakter huruf, angka, tanda - atau _.');
      }
      const requestHash = idem ? crypto.createHash('sha256').update(idem).digest('hex') : null;
      const inputHash = crypto.createHash('sha256').update(JSON.stringify({
        image: req.body.characterImage, video: req.body.referenceVideo,
        prompt: req.body.prompt || '', orientation: req.body.characterOrientation || 'video', roomId,
      })).digest('hex');
      if (inFlight.has(auth.user.user_id)) throw new MotionError(409, 'Request motion sebelumnya masih diproses. Jangan kirim ulang.');
      lockedUser = auth.user.user_id;
      inFlight.add(lockedUser);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize reservations across instances, not only within this process.
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [18477, auth.user.user_id]);
        if (requestHash) {
          const old = await client.query(`SELECT * FROM video_generation_tasks
            WHERE xclip_api_key_id = $1 AND retry_data->>'provider' = $2
            AND retry_data->>'requestHash' = $3 ORDER BY created_at DESC LIMIT 1`,
          [auth.id, MARKER, requestHash]);
          if (old.rows[0]) {
            if (old.rows[0].retry_data.inputHash !== inputHash) throw new MotionError(409, 'Idempotency-Key sudah dipakai untuk input berbeda.');
            await client.query('COMMIT');
            return res.json(publicMotion(old.rows[0]));
          }
        }
        const recent = await client.query(`SELECT * FROM video_generation_tasks
          WHERE user_id = $1 AND retry_data->>'provider' = $2
          AND (status IN ('pending','processing') OR created_at > NOW() - ($3::int * INTERVAL '1 millisecond'))
          ORDER BY created_at DESC LIMIT 1`, [auth.user.user_id, MARKER, cooldownMs]);
        if (recent.rows[0]) {
          row = recent.rows[0];
          throw new MotionError(409, row.status === 'pending' ? UNCERTAIN : 'Generasi motion sebelumnya masih aktif atau dalam cooldown.');
        }
        const remaining = getCooldown(auth.user.user_id, 'motion');
        if (remaining > 0) throw new MotionError(429, `Tunggu ${Math.ceil(remaining / 1000)} detik sebelum generasi berikutnya.`);
        const room = await client.query('SELECT max_users FROM motion_rooms WHERE id = $1', [roomId]);
        const usage = await client.query(`SELECT COUNT(DISTINCT xclip_api_key_id) AS active_users
          FROM video_generation_tasks WHERE model LIKE 'motion-%' AND room_id = $1
          AND created_at > NOW() - INTERVAL '30 minutes' AND xclip_api_key_id <> $2`, [roomId, auth.id]);
        if (Number(usage.rows[0]?.active_users || 0) >= (room.rows[0]?.max_users || 100)) {
          throw new MotionError(409, 'Room motion penuh. Pilih room lain.');
        }
        const id = 'xmc_' + crypto.randomBytes(16).toString('hex');
        const reserved = await client.query(`INSERT INTO video_generation_tasks
          (task_id, xclip_api_key_id, user_id, room_id, model, status, used_key_name, retry_data, retry_count)
          VALUES ($1,$2,$3,$4,$5,'pending','ALRIZ_API_KEY',$6::jsonb,0) RETURNING *`,
        [id, auth.id, auth.user.user_id, roomId, 'motion-' + PUBLIC_MODEL,
          JSON.stringify({ provider: MARKER, phase: 'preflight', requestHash, inputHash, maxRetries: 0 })]);
        row = reserved.rows[0];
        await client.query('COMMIT');
        ownsReservation = true;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }

      report('motion_submit_started', row);
      await provider.preflight();
      const base = `${req.protocol}://${req.get('host')}`;
      async function media(value, type) {
        if (/^https:\/\//i.test(value)) return value;
        return (await saveFile(value, type, base)).publicUrl;
      }
      const imageUrl = await media(req.body.characterImage, 'image');
      const videoUrl = await media(req.body.referenceVideo, 'video');
      // Persist BEFORE the billable call; a crash/timeout cannot trigger an automatic resubmit.
      await pool.query(`UPDATE video_generation_tasks SET retry_data = retry_data || $2::jsonb WHERE task_id = $1`,
        [row.task_id, JSON.stringify({ phase: 'submitting' })]);
      submitted = true;
      const jobId = await provider.submit({ imageUrl, videoUrl, prompt: req.body.prompt?.trim() });
      const data = { ...row.retry_data, phase: 'accepted', jobId };
      const saved = await pool.query(`UPDATE video_generation_tasks SET status = 'processing', retry_data = $2::jsonb
        WHERE task_id = $1 RETURNING *`, [row.task_id, JSON.stringify(data)]);
      row = saved.rows[0];
      setCooldown(auth.user.user_id, 'motion');
      await pool.query(`UPDATE xclip_api_keys SET requests_count = requests_count + 1,
        last_used_at = CURRENT_TIMESTAMP WHERE id = $1`, [auth.id]).catch(error => report('motion_usage_failed', row, error));
      report('motion_accepted', row);
      return res.status(202).json(publicMotion(row));
    } catch (error) {
      // Only the reservation created by THIS request may be marked failed.
      // A conflict referencing someone else's active reservation is read-only.
      if (ownsReservation && row?.retry_data?.phase === 'preflight') {
        const uncertain = submitted && (!(error instanceof MotionError) || error.uncertain);
        await pool.query(`UPDATE video_generation_tasks SET status = $2::text,
          error_message = $3, retry_data = retry_data || $4::jsonb
          WHERE task_id = $1 AND status = 'pending'`,
        [row.task_id, uncertain ? 'pending' : 'failed', uncertain ? UNCERTAIN : 'Generasi motion control gagal.',
          JSON.stringify({ phase: uncertain ? 'uncertain' : 'rejected' })]).catch(e => report('motion_persist_failed', row, e));
        if (uncertain) error = new MotionError(503, UNCERTAIN, { uncertain: true });
      }
      return sendError(res, error, row);
    } finally {
      if (lockedUser != null) inFlight.delete(lockedUser);
    }
  });

  router.get('/tasks/:taskId', async (req, res, next) => {
    try {
      const auth = await authenticate(req);
      const found = await pool.query(`SELECT * FROM video_generation_tasks
        WHERE task_id = $1 AND xclip_api_key_id = $2`, [req.params.taskId, auth.id]);
      const row = found.rows[0];
      if (!isOurs(row)) {
        if (req.params.taskId.startsWith('xmc_')) throw new MotionError(404, 'Task tidak ditemukan.');
        return next(); // Previously created Freepik jobs retain their original polling path.
      }
      return res.json(publicMotion(await poll(row)));
    } catch (error) { return sendError(res, error); }
  });
  router.get('/tasks/:taskId/video', async (req, res) => {
    try {
      const auth = await authenticate(req, true);
      const found = await pool.query(`SELECT * FROM video_generation_tasks
        WHERE task_id = $1 AND ${auth.column} = $2`, [req.params.taskId, auth.id]);
      const row = found.rows[0];
      if (!isOurs(row) || row.status !== 'completed') throw new MotionError(404, 'Video tidak ditemukan.');
      // Refresh the signed URL server-side. Neither API keys nor upstream URLs reach the browser.
      const result = await provider.poll(row.retry_data.jobId);
      if (result.status !== 'completed') throw new MotionError(503, 'Video hasil belum tersedia.');
      return await stream(req, res, result.videoUrl);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      return sendError(res, error);
    }
  });
  router.reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const tasks = await pool.query(`SELECT * FROM video_generation_tasks
        WHERE retry_data->>'provider' = $1 AND retry_data->>'jobId' IS NOT NULL
        AND status IN ('pending','processing')
        ORDER BY retry_data->>'lastPollAt' NULLS FIRST, created_at LIMIT 20`, [MARKER]);
      for (const row of tasks.rows) await poll(row).catch(() => {});
    } catch (error) { report('motion_worker_failed', null, error); }
    finally { reconciling = false; }
  };
  router.status = async row => publicMotion(await poll(row));
  return router;
};

module.exports.validateInput = validateInput;
module.exports.publicMotion = publicMotion;

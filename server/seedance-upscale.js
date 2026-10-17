const { verify1080p } = require('./video-resolution');
const { createGenerationLogger, describeError } = require('./generation-log');
const { MODELS } = require('./video-models');

function createSeedanceUpscale({ pool, provider, verify = verify1080p, logger = createGenerationLogger() }) {
  async function prepare(duration) {
    return { required: true, phase: 'waiting_source', duration, ...(await provider.context(duration)) };
  }
  async function process(row, source) {
    if (source?.status === 'failed') return source;
    if (source && source.status !== 'completed') return source;
    const client = await pool.connect();
    let locked = false, destroy = true;
    try {
      await client.query('SELECT pg_advisory_lock($1, hashtext($2))', [28477, row.task_id]);
      locked = true;
      destroy = false;
      row = (await client.query('SELECT * FROM video_generation_tasks WHERE task_id = $1', [row.task_id])).rows[0];
      if (['completed', 'failed'].includes(row.status)) return { status: row.status, videoUrl: row.video_url };
      let state = { ...(row.retry_data?.upscale || {}) };
      async function save(patch) {
        state = { ...state, ...patch, required: true };
        await client.query(`UPDATE video_generation_tasks
          SET retry_data = jsonb_set(retry_data, '{upscale}', $2::jsonb)
          WHERE task_id = $1 AND status IN ('pending','processing')`,
        [row.task_id, JSON.stringify(state)]);
      }
      const duration = state.duration || MODELS[row.model].maxDuration;
      if (!state.sourceUrl) {
        if (!source?.videoUrl) return { status: 'processing' };
        if (!state.keyId) state = { ...state, ...(await prepare(duration)) };
        await save({ sourceUrl: source.videoUrl, phase: 'ready' });
      }
      if (['submitting', 'uncertain'].includes(state.phase) && !state.runId) {
        logger.warn('upscale_delivery_uncertain', { taskId: row.task_id, stage: 'upscale', status: 'processing' });
        return { status: 'processing' }; // Never repeat a possibly accepted paid request.
      }
      if (state.phase === 'failed') return { status: 'failed', failureReason: 'upstream_generation_failed' };
      if (state.phase === 'verified' && state.resultUrl) return { status: 'completed', videoUrl: state.resultUrl };
      if (!state.runId) {
        await save({ phase: 'submitting' }); // Commit intent before the billable POST.
        logger.info('upscale_submit_started', { taskId: row.task_id, stage: 'upscale', status: 'processing' });
        try {
          const runId = await provider.submit(state.keyId, state.sourceUrl, duration);
          await save({ phase: 'processing', runId });
          logger.info('upscale_accepted', { taskId: row.task_id, stage: 'upscale', status: 'processing' });
        } catch (error) {
          await save({ phase: error.deliveryUncertain || !(error.diagnostic) ? 'uncertain' : 'failed' });
          logger.error('upscale_submit_failed', { taskId: row.task_id, stage: 'upscale', ...describeError(error) });
          return { status: state.phase === 'failed' ? 'failed' : 'processing',
            ...(state.phase === 'failed' ? { failureReason: 'upstream_generation_failed' } : {}) };
        }
        return { status: 'processing' };
      }
      if (!state.resultUrl) {
        const result = await provider.poll(state.keyId, state.runId);
        if (result.status === 'failed') {
          await save({ phase: 'failed' });
          return { status: 'failed', failureReason: 'upstream_generation_failed' };
        }
        if (result.status !== 'completed') {
          logger.info('upscale_in_progress', { taskId: row.task_id, stage: 'upscale', status: 'processing' });
          return { status: 'processing' };
        }
        await save({ resultUrl: result.videoUrl, phase: 'verifying' });
      }
      if (!await verify(state.resultUrl)) {
        await save({ phase: 'failed' });
        logger.error('upscale_resolution_rejected', { taskId: row.task_id, stage: 'verify_resolution', status: 'failed' });
        return { status: 'failed', failureReason: 'upstream_generation_failed' };
      }
      await save({ phase: 'verified' });
      logger.info('upscale_verified', { taskId: row.task_id, stage: 'verify_resolution', status: 'processing' });
      return { status: 'completed', videoUrl: state.resultUrl };
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock($1, hashtext($2))', [28477, row.task_id]); }
        catch { destroy = true; }
      }
      client.release(destroy);
    }
  }
  return { prepare, context: prepare, process };
}
module.exports = { createSeedanceUpscale };

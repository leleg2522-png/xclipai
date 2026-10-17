const { ServiceError } = require('./wan-provider');
const { checkedUrl } = require('./public-video');

const MODEL = 'bytedance-video-upscaler';
const safeError = (reason, status, uncertain = false) => Object.assign(
  new ServiceError(503, 'Peningkatan kualitas video sementara tidak tersedia.'),
  { diagnostic: { reason, upstreamStatus: status }, deliveryUncertain: uncertain });

function createRenderfulUpscaleProvider(pool, fetcher = fetch) {
  async function credential(id, submitting = false) {
    const { rows } = await pool.query(id == null
      ? `SELECT id, api_key FROM renderful_key_pool WHERE status = 'available'
         AND assigned_to IS NULL AND dead_at IS NULL AND api_key IS NOT NULL AND api_key <> ''
         ORDER BY id LIMIT 5`
      : `SELECT id, api_key FROM renderful_key_pool WHERE id = $1${submitting
        ? " AND status = 'available' AND assigned_to IS NULL AND dead_at IS NULL" : ''}`,
    id == null ? [] : [id]);
    if (!rows.length || !rows[0].api_key) throw safeError('generation_credentials_missing');
    return rows;
  }
  async function call(key, path, body) {
    let response;
    try {
      response = await fetcher('https://api.renderful.ai/api/v1' + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { Authorization: `Bearer ${key.api_key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw safeError('upstream_network_error', undefined, !!body); }
    if (!response.ok) {
      const code = response.status;
      throw safeError(code === 401 ? 'upstream_auth_failed' : code === 403 ? 'upstream_forbidden'
        : code === 429 ? 'upstream_rate_limited' : code >= 500 ? 'upstream_unavailable'
          : 'upstream_request_rejected', code, !!body && (code >= 500 || code === 408));
    }
    try { return await response.json(); }
    catch { throw safeError('upstream_response_invalid', response.status, !!body); }
  }
  async function context(duration) {
    const keys = await credential();
    let lastError;
    for (const key of keys) {
      try {
        const balance = await call(key, '/account/balance');
        // Current published 1080p rate; this is a readiness check, not a payment.
        if (!Number.isFinite(Number(balance.balance_available)) ||
            Number(balance.balance_available) < duration * 0.00726) {
          throw safeError('upstream_insufficient_credits');
        }
        return { keyId: key.id };
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }
  return {
    context,
    async submit(keyId, sourceUrl, duration) {
      checkedUrl(sourceUrl);
      const [key] = await credential(keyId, true);
      const result = await call(key, '/generations', {
        type: 'video-to-video', model: MODEL, video_url: sourceUrl, resolution: '1080p', duration,
      });
      if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(result.id)) {
        throw safeError('upstream_response_invalid', undefined, true);
      }
      return result.id;
    },
    async poll(keyId, runId) {
      if (!/^[a-zA-Z0-9_-]{1,150}$/.test(runId || '')) throw safeError('upstream_response_invalid');
      const [key] = await credential(keyId);
      const result = await call(key, '/generations/' + encodeURIComponent(runId));
      if (result.status === 'failed') return { status: 'failed' };
      if (['queued', 'processing'].includes(result.status)) return { status: 'processing' };
      if (result.status !== 'completed') throw safeError('upstream_response_invalid');
      const url = result.outputs?.[0] || result.output;
      try { checkedUrl(url); } catch { throw safeError('upstream_response_invalid'); }
      return { status: 'completed', videoUrl: url };
    },
  };
}
module.exports = { createRenderfulUpscaleProvider };

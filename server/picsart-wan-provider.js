const axios = require('axios');
const crypto = require('node:crypto');
const FormData = require('form-data');
const { ServiceError, validateInput } = require('./wan-provider');
const { checkedUrl } = require('./public-video');

const API = 'https://api.picsart.com';
const unavailable = (reason = 'upstream_response_invalid') => Object.assign(
  new ServiceError(503, 'Layanan model sementara tidak tersedia. Coba lagi nanti.'), { diagnostic: { reason } });

// Contract derived from the supplied capture. Never use captured cookies or tokens.
function createPicsartVideoProvider(pool, definition, request = axios.request) {
  const devices = new Map();
  let cached;
  async function credential(id) {
    const { rows } = await pool.query(id == null
      ? `SELECT p.id, p.access_token FROM picsart_credentials p
         WHERE p.status = 'available' AND p.pool = 'p500'
         AND p.access_token IS NOT NULL AND p.access_token <> ''
         AND p.access_expires_at > NOW() + INTERVAL '2 minutes'
         ORDER BY p.id LIMIT 10`
      : `SELECT id, access_token FROM picsart_credentials WHERE id = $1
         AND access_token IS NOT NULL AND access_token <> ''
         AND access_expires_at > NOW()`, id == null ? [] : [id]);
    if (!rows.length) throw unavailable('generation_credentials_missing');
    return rows;
  }
  async function call(account, method, path, data, upload = false, dispatch = false) {
    let device = devices.get(account.id);
    if (!device) {
      device = crypto.randomUUID();
      if (devices.size > 100) devices.clear();
      devices.set(account.id, device);
    }
    const token = account.access_token.replace(/^Bearer\s+/i, '');
    try {
      const response = await request({
        method, url: (upload ? 'https://upload.picsart.com' : API) + path,
        data, timeout: upload ? 60000 : 25000, maxRedirects: 0,
        headers: {
          'X-App-Authorization': `Bearer ${token}`, platform: 'website', deviceid: device,
          'x-touchpoint': 'com.picsart.ai-playground',
          ...(upload ? data.getHeaders() : { 'Content-Type': 'application/json' }),
        },
        ...(upload ? { maxBodyLength: 16000000, maxContentLength: 1000000 } : {}),
      });
      if (response.data?.status !== 'success' || !response.data.response) {
        const error = unavailable();
        // HTTP success with an invalid body does not prove a paid submit was rejected.
        error.deliveryUncertain = dispatch;
        throw error;
      }
      return response.data.response;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const status = error.response?.status;
      const safe = unavailable(
        ['ETIMEDOUT', 'ECONNABORTED'].includes(error.code) ? 'upstream_timeout'
          : status === 401 ? 'upstream_auth_failed' : status === 403 ? 'upstream_forbidden'
          : status === 429 ? 'upstream_rate_limited' : status >= 500 ? 'upstream_unavailable'
          : status >= 400 ? 'upstream_request_rejected' : 'upstream_network_error');
      safe.diagnostic.upstreamStatus = status;
      if (['ETIMEDOUT','ECONNABORTED','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error.code)) safe.code = error.code;
      safe.deliveryUncertain = dispatch && (!error.response || status >= 500 || status === 408);
      throw safe;
    }
  }
  async function context(requiredCredits = definition.minimumCredits) {
    if (cached && cached.until > Date.now() && cached.credits >= requiredCredits) return { keyId: cached.id };
    const accounts = await credential();
    let lastError;
    // Read-only balance checks may fail over; a paid submission NEVER does.
    for (const account of accounts) {
      try {
        const balance = await call(account, 'GET', '/guard/credits');
        if (!Number.isFinite(balance.credits) || balance.credits < requiredCredits) {
          lastError = unavailable('upstream_insufficient_credits');
          continue;
        }
        cached = { id: account.id, credits: balance.credits, until: Date.now() + 30000 };
        return { keyId: account.id };
      } catch (error) { lastError = error; }
    }
    throw lastError || unavailable('generation_credentials_missing');
  }
  async function prepare(raw) {
    const { image, ...fields } = raw;
    const input = validateInput({ ...fields, ...(image ? { image } : {}) });
    if (input.model !== definition.model) throw new ServiceError(400, 'Model Xclip tidak dikenal.');
    let requiredCredits = definition.minimumCredits;
    // Only preflight may select another account. Never retry/fail over a paid submit.
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctx = await context(requiredCredits);
      const account = (await credential(ctx.keyId))[0];
      let imageUrl;
      if (input.image) {
        const [, extension, encoded] = input.image.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
        const form = new FormData();
        form.append('file', Buffer.from(encoded, 'base64'), { filename: `reference.${extension}`, contentType: `image/${extension}` });
        form.append('type', 'editing-temp');
        const image = await call(account, 'POST', '/v2/files', form, true);
        imageUrl = image.url;
        try { checkedUrl(imageUrl); } catch { throw unavailable(); }
      }
      const params = definition.params(input, imageUrl);
      // A quote is not a generation. Validate the actual requested combination before reserving money.
      const quote = await call(account, 'POST', `${definition.workflow}/options`, { params });
      if (!Number.isFinite(quote.credits) || quote.credits <= 0 || quote.usageAmount !== input.duration || quote.estimated !== false) throw unavailable();
      const balance = await call(account, 'GET', '/guard/credits');
      if (!Number.isFinite(balance.credits) || balance.credits < quote.credits) {
        requiredCredits = quote.credits;
        cached = null;
        continue;
      }
      return { keyId: account.id, body: { params: {
        ...params, options: { inputs_transformation: { downscale_oversized_images: true } },
      } } };
    }
    throw unavailable('upstream_insufficient_credits');
  }
  async function start(prepared) {
    const account = (await credential(prepared.keyId))[0];
    const result = await call(account, 'POST', `${definition.workflow}/submit`, prepared.body, false, true);
    if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.id)) {
      const error = unavailable(); error.deliveryUncertain = true; throw error;
    }
    cached = null;
    return result.id;
  }
  async function poll(meta) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(meta?.runId || '')) throw unavailable();
    const account = (await credential(meta.keyId))[0];
    const result = await call(account, 'GET', `${definition.workflow}/${encodeURIComponent(meta.runId)}/result`);
    const status = { ACCEPTED: 'pending', IN_PROGRESS: 'processing', COMPLETED: 'completed',
      FAILED: 'failed', CANCELED: 'failed', CANCELLED: 'failed' }[result.status];
    if (!status) throw unavailable(); // Unknown statuses are not proof of failure/refund.
    let videoUrl = null;
    if (status === 'completed') {
      videoUrl = result.result?.[definition.resultField];
      try { checkedUrl(videoUrl); } catch { throw unavailable(); }
    }
    return { status, videoUrl,
      ...(Number.isFinite(result.progress?.percent) ? { progress: Math.min(100, Math.max(0, result.progress.percent)) } : {}),
      ...(status === 'failed' ? { failureReason: 'upstream_generation_failed' } : {}),
    };
  }
  return { context, prepare, start, poll, handlesImage: true };
}
function createPicsartWanProvider(pool, request = axios.request) {
  return createPicsartVideoProvider(pool, {
    model: 'wan-3.0', workflow: '/gw-v2/workflows/wan/v3/video', minimumCredits: 90, resultField: 'url',
    params: (input, imageUrl) => ({
      model: 'wan3.0-video', resolution: input.resolution.toUpperCase(), ratio: input.aspectRatio,
      duration: input.duration, audio: input.audio, enable_thinking: false, watermark: false,
      prompt: input.prompt,
      ...(imageUrl ? { media: [{ type: 'reference_image', url: imageUrl }] } : {}),
    }),
  }, request);
}
module.exports = { createPicsartWanProvider, createPicsartVideoProvider };

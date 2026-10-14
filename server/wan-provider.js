const axios = require('axios');
const { checkedUrl } = require('./public-video');

const MODEL = 'wan-3.0-uncensored';
class ServiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const unavailable = () => new ServiceError(503, 'Layanan model sementara tidak tersedia. Coba lagi nanti.');

// Provider URLs, credentials, model IDs and error bodies never leave this module.
function createWanProvider(pool, request = axios.request, env = process.env) {
  const contexts = new Map();
  async function credential(id) {
    const { rows } = await pool.query(id == null
      ? "SELECT id, api_key FROM flora_key_pool WHERE status IN ('available', 'active') ORDER BY id LIMIT 1"
      : 'SELECT id, api_key FROM flora_key_pool WHERE id = $1', id == null ? [] : [id]);
    if (!rows[0]?.api_key) throw unavailable();
    return rows[0];
  }
  async function call(key, method, path, data, idempotencyKey) {
    try {
      const response = await request({
        method, url: `https://app.flora.ai/api/v1/${path}`, data,
        timeout: 20000, maxRedirects: 0,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      });
      return response.data;
    } catch (error) {
      const safe = unavailable();
      // A POST without a response may have been accepted and charged. Do not retry.
      safe.deliveryUncertain = method === 'POST' &&
        (!error.response || error.response.status >= 500 || error.response.status === 408);
      throw safe;
    }
  }
  async function context() {
    const key = await credential();
    const cached = contexts.get(key.id);
    if (cached && cached.until > Date.now()) return { ...cached.value, key };
    const catalog = await call(key.api_key, 'GET', 'models?type=video');
    const workspaces = await call(key.api_key, 'GET', 'workspaces');
    const workspace = env.FLORA_WORKSPACE_ID
      ? workspaces.workspaces?.find(w => w.workspace_id === env.FLORA_WORKSPACE_ID)
      : workspaces.workspaces?.length === 1 ? workspaces.workspaces[0] : null;
    if (!workspace) throw unavailable(); // Never choose an arbitrary billing workspace.
    const projects = await call(key.api_key, 'GET',
      `projects?workspace_id=${encodeURIComponent(workspace.workspace_id)}&limit=100`);
    const project = env.FLORA_PROJECT_ID
      ? projects.projects?.find(p => p.project_id === env.FLORA_PROJECT_ID)
      : projects.projects?.length === 1 && !projects.meta?.next_cursor ? projects.projects[0] : null;
    if (!project || project.workspace_id !== workspace.workspace_id ||
        !/^ws_[\w-]+$/.test(workspace.workspace_id) || !/^prj_[\w-]+$/.test(project.project_id)) throw unavailable();
    const modes = {};
    for (const [mode, capability] of [['text', 'text-to-video'], ['image', 'image-to-video']]) {
      const matches = (catalog.models || []).filter(m =>
        m.name?.toUpperCase() === 'WAN 3.0' && m.capabilities?.includes(capability));
      if (matches.length !== 1) throw unavailable();
      const model = matches[0];
      if (!model.model_id || !model.params?.find(p => p.name === 'resolution')?.options?.some(o => o.value === '480p') ||
          !model.params.find(p => p.name === 'duration')?.options?.some(o => o.value === '30')) throw unavailable();
      modes[mode] = model;
    }
    const value = { workspaceId: workspace.workspace_id, projectId: project.project_id, modes };
    contexts.clear(); // Only the currently selected account is cached, never credentials.
    contexts.set(key.id, { value, until: Date.now() + 300000 });
    return { ...value, key };
  }
  async function prepare(input, imageUrl) {
    const ctx = await context();
    const model = ctx.modes[input.image ? 'image' : 'text'];
    const params = { duration: String(input.duration), resolution: input.resolution,
      aspect_ratio: input.aspectRatio, audio: input.audio };
    if (input.image) params.image_url = imageUrl;
    for (const [name, value] of Object.entries(params)) {
      const spec = model.params.find(p => p.name === name);
      if (!spec || spec.options && !spec.options.some(o => o.value === value)) throw unavailable();
    }
    return { keyId: ctx.key.id, body: { type: 'video', prompt: input.prompt,
      model: model.model_id, workspace_id: ctx.workspaceId, project_id: ctx.projectId, params } };
  }
  async function start(prepared, taskId) {
    const key = await credential(prepared.keyId);
    const data = await call(key.api_key, 'POST', 'generate', prepared.body, taskId);
    if (!/^run_[\w-]+$/.test(data?.run_id)) {
      const error = unavailable();
      error.deliveryUncertain = true;
      throw error;
    }
    return data.run_id;
  }
  async function poll(meta) {
    if (!/^run_[\w-]+$/.test(meta?.runId)) throw unavailable();
    const key = await credential(meta.keyId); // Same key/account as creation, not the current pool selection.
    const data = await call(key.api_key, 'GET', `runs/${encodeURIComponent(meta.runId)}`);
    const status = { pending: 'pending', running: 'processing', completed: 'completed', failed: 'failed' }[data.status];
    if (!status) throw unavailable();
    let videoUrl = null;
    if (status === 'completed') {
      videoUrl = data.outputs?.find(o => o.type === 'videoUrl')?.url;
      if (!videoUrl) throw unavailable();
      try { checkedUrl(videoUrl); } catch { throw unavailable(); }
    }
    return { status, videoUrl };
  }
  return { context, prepare, start, poll };
}

function validateInput(body) {
  const allowed = ['model', 'prompt', 'image', 'duration', 'resolution', 'aspectRatio', 'audio'];
  if (Object.keys(body).some(k => !allowed.includes(k))) throw new ServiceError(400, 'Parameter request tidak didukung.');
  if (body.model !== MODEL) throw new ServiceError(400, 'Model Xclip tidak dikenal.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 10000) {
    throw new ServiceError(400, 'Prompt wajib diisi, maksimal 10000 karakter.');
  }
  const duration = body.duration === undefined ? 30 : body.duration;
  const resolution = body.resolution === undefined ? '480p' : body.resolution;
  const aspectRatio = body.aspectRatio === undefined ? '16:9' : body.aspectRatio;
  const audio = body.audio === undefined ? true : body.audio;
  if (!Number.isInteger(duration) || duration < 2 || duration > 30) throw new ServiceError(400, 'Durasi harus 2–30 detik.');
  if (resolution !== '480p') throw new ServiceError(400, 'Konfigurasi model ini menggunakan resolusi 480p.');
  if (!['16:9', '9:16', '1:1', '4:3', '3:4'].includes(aspectRatio)) throw new ServiceError(400, 'Rasio aspek tidak didukung.');
  if (typeof audio !== 'boolean') throw new ServiceError(400, 'Audio harus berupa boolean.');
  const image = body.image === undefined ? '' : body.image;
  if (body.image !== undefined) {
    if (typeof image !== 'string' || image.length > 14000000) throw new ServiceError(400, 'Gambar tidak valid atau terlalu besar.');
    const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new ServiceError(400, 'Gambar harus data URI PNG, JPEG, atau WebP.');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid) throw new ServiceError(400, 'Isi gambar tidak sesuai format.');
  }
  return { model: MODEL, prompt: body.prompt.trim(), image, duration, resolution, aspectRatio, audio };
}
module.exports = { MODEL, ServiceError, createWanProvider, validateInput };

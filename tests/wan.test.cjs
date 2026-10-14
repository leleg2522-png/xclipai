const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { MODEL, ServiceError, validateInput, createWanProvider } = require('../server/wan-provider');
const wanRoutes = require('../server/wan-routes');

const png = 'data:image/png;base64,iVBORw0KGgo=';
const catalog = () => ({
  models: ['text-to-video', 'image-to-video'].map((cap, i) => ({
    name: 'WAN 3.0', model_id: `${i ? 'i2v' : 't2v'}-wan-3-0-live-id`,
    capabilities: [cap], params: [
      { name: 'resolution', options: [{ value: '480p' }] },
      { name: 'duration', options: [{ value: '30' }, { value: '5' }] },
      { name: 'aspect_ratio', options: [{ value: '16:9' }, { value: '9:16' }] },
      { name: 'audio', type: 'bool' }, ...(i ? [{ name: 'image_url', type: 'string' }] : []),
    ],
  })),
});
function providerFixture(overrides = {}) {
  const calls = [];
  const pool = { async query(sql, params) {
    return { rows: [{ id: params?.[0] || 7, api_key: 'fake_secret_for_tests' }] };
  } };
  const request = async options => {
    calls.push(options);
    const path = options.url.replace('https://app.flora.ai/api/v1/', '');
    if (overrides.request) return overrides.request(options, path);
    return { data: path === 'models?type=video' ? (overrides.catalog || catalog())
      : path === 'workspaces' ? { workspaces: overrides.workspaces || [{ workspace_id: 'ws_test' }] }
      : path.startsWith('projects?') ? { projects: overrides.projects || [{ project_id: 'prj_test', workspace_id: 'ws_test' }], meta: {} }
      : path === 'generate' ? { run_id: 'run_test' }
      : { status: 'completed', outputs: [{ type: 'videoUrl', url: 'https://media.flora.ai/test.mp4' }] } };
  };
  return { provider: createWanProvider(pool, request, {}), calls };
}

test('Wan input defaults to 480p/30s, validates controls and rejects invented flags and invalid images', () => {
  const input = validateInput({ model: MODEL, prompt: ' hello ' });
  assert.equal(input.duration, 30);
  assert.equal(input.resolution, '480p');
  assert.equal(input.prompt, 'hello');
  assert.equal(validateInput({ model: MODEL, prompt: 'hi', image: png }).image, png);
  for (const change of [{ duration: 31 }, { duration: '30' }, { duration: null }, { resolution: '720p' },
    { audio: 'false' }, { image: false }, { image: '' }, { image: 'https://example.com/a.png' },
    { image: 'data:image/png;base64,YmFk' }, { uncensored: true }, { aspectRatio: 'auto' }]) {
    assert.throws(() => validateInput({ model: MODEL, prompt: 'hi', ...change }), ServiceError);
  }
});

test('adapter discovers live endpoint IDs, maps text/image parameters, and never follows upstream poll URLs', async () => {
  const { provider, calls } = providerFixture();
  const text = await provider.prepare(validateInput({ model: MODEL, prompt: 'hi' }));
  assert.equal(text.body.model, 't2v-wan-3-0-live-id');
  assert.deepEqual(text.body.params, { duration: '30', resolution: '480p', aspect_ratio: '16:9', audio: true });
  assert.equal(text.body.type, 'video');
  const image = await provider.prepare(validateInput({ model: MODEL, prompt: 'hi', image: png }), 'https://xclip.example/a.png');
  assert.equal(image.body.model, 'i2v-wan-3-0-live-id');
  assert.equal(image.body.params.image_url, 'https://xclip.example/a.png');
  assert.equal(await provider.start(text, 'xv_test'), 'run_test');
  assert.equal(calls.at(-1).headers['Idempotency-Key'], 'xv_test');
  const polled = await provider.poll({ runId: 'run_test', keyId: 7, pollUrl: 'https://evil.example' });
  assert.equal(polled.status, 'completed');
  assert.equal(calls.at(-1).url, 'https://app.flora.ai/api/v1/runs/run_test');
  assert.equal(calls.filter(c => c.url.endsWith('models?type=video')).length, 1);
});

test('missing capabilities and ambiguous billing contexts fail before any generation', async () => {
  const missing = catalog();
  missing.models[0].params[0].options = [{ value: '720p' }];
  for (const config of [{ catalog: missing }, { workspaces: [{ workspace_id: 'ws_test' }, { workspace_id: 'ws_other' }] },
    { projects: [] }, { projects: [{ project_id: 'prj_test', workspace_id: 'ws_wrong' }] }]) {
    const { provider, calls } = providerFixture(config);
    await assert.rejects(provider.context(), ServiceError);
    assert.ok(calls.every(c => c.method === 'GET'));
  }
});

test('upstream failures are sanitized; uncertain paid POST is never automatically retried', async () => {
  const { provider, calls } = providerFixture({ request: async () => {
    throw Object.assign(new Error('flora fake_secret CDN payload'), { response: { status: 401, data: 'flora' } });
  } });
  await assert.rejects(provider.context(), error => error.status === 503 && !/flora|fake_secret/i.test(error.message));
  const h = providerFixture({ request: async () => { throw new Error('Network timeout'); } });
  await assert.rejects(h.provider.start({ keyId: 7, body: {} }, 'xv_t'), error => error.deliveryUncertain);
  assert.equal(h.calls.length, 1);
  assert.equal(calls.length, 1);
  const serverFailure = providerFixture({ request: async () => {
    throw Object.assign(new Error('Gateway failure'), { response: { status: 503 } });
  } });
  await assert.rejects(serverFailure.provider.start({ keyId: 7, body: {} }, 'xv_t'),
    error => error.deliveryUncertain);
  assert.equal(serverFailure.calls.length, 1);
});

async function routeFixture(t, opts = {}) {
  const rows = new Map();
  const locks = new Map();
  const stats = { starts: 0, polls: 0, released: 0, uploads: 0, counts: 0 };
  async function query(sql, p = []) {
    if (sql.includes('pg_advisory_unlock')) {
      locks.get(p.join(':'))?.resolvers.shift()?.();
      return { rows: [] };
    }
    if (sql.includes('pg_advisory_lock')) {
      const id = p.join(':');
      const entry = locks.get(id) || { tail: Promise.resolve(), resolvers: [] };
      const previous = entry.tail;
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      entry.tail = promise;
      entry.resolvers.push(resolve);
      locks.set(id, entry);
      await previous;
      return { rows: [] };
    }
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: opts.quotaUsed || 0 }] };
    if (sql.includes('SELECT * FROM video_generation_tasks')) {
      const row = rows.get(p[0]);
      const column = sql.includes('AND user_id') ? 'user_id' : 'xclip_api_key_id';
      return { rows: row && row[column] === p[1] ? [structuredClone(row)] : [] };
    }
    if (sql.includes("retry_data->>'delivery'")) return { rows: [...rows.values()].filter(r =>
      r.user_id === p[0] && r.status === 'pending' && r.retry_data.delivery === 'unconfirmed') };
    if (sql.includes('SELECT task_id')) return { rows: [...rows.values()].filter(r => r.user_id === p[0]) };
    if (sql.includes('INSERT INTO video_generation_tasks')) {
      const row = { task_id: p[0], xclip_api_key_id: p[1], user_id: p[2], room_id: p[3],
        model: p[4], status: 'pending', retry_data: JSON.parse(p[5]), created_at: new Date().toISOString() };
      rows.set(row.task_id, row);
      return { rows: [structuredClone(row)] };
    }
    if (sql.includes("SET status = 'processing'")) {
      Object.assign(rows.get(p[1]), { status: 'processing', retry_data: JSON.parse(p[0]) });
      return { rows: [] };
    }
    if (sql.includes("SET status = 'failed'")) {
      rows.get(p[1]).status = 'failed';
      return { rows: [] };
    }
    if (sql.includes('SET status = $1')) {
      Object.assign(rows.get(p[2]), { status: p[0], video_url: p[1] });
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE xclip_api_keys')) { stats.counts++; return { rows: [] }; }
    throw new Error('Unexpected fixture SQL: ' + sql);
  }
  const pool = { query, async connect() { return { query, release() { stats.released++; } }; } };
  const provider = {
    async context() { if (opts.unavailable) throw new ServiceError(503, 'Layanan sementara tidak tersedia.'); },
    async prepare() { return { keyId: 7, body: {} }; },
    async start() {
      stats.starts++;
      if (opts.startFailure) throw Object.assign(new ServiceError(503, 'Generasi sementara tidak tersedia.'),
        { deliveryUncertain: opts.uncertain });
      return 'run_test';
    },
    async poll() { stats.polls++; return { status: opts.failed ? 'failed' : 'completed',
      videoUrl: opts.failed ? null : 'https://media.flora.ai/a.mp4?secret=fake' }; },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: Number(req.headers['x-test-user']) || null }; next(); });
  app.use(wanRoutes({ pool, provider, validateKey: async key =>
    key === 'revoked' ? null : { id: key === 'other' ? 2 : 1, user_id: key === 'other' ? 2 : 1,
      room_id: opts.noSubscription ? null : 1, is_admin: false },
    saveImage: async () => { stats.uploads++; return 'https://xclip.example/test.png'; } }));
  app.post('/api/videogen/proxy', (_req, res) => res.json({ legacy: true }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function call(path, body, headers = {}) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  const generate = (body = {}, headers = {}) => call('/api/videogen/proxy',
    { model: MODEL, prompt: 'test', ...body }, { 'X-Xclip-Key': 'owner', 'Idempotency-Key': 'request-one', ...headers });
  return { rows, stats, call, generate };
}

test('catalog requires authentication and only returns the public Xclip projection', async t => {
  const h = await routeFixture(t);
  assert.equal((await h.call('/api/developer/models')).status, 401);
  const r = await h.call('/api/developer/models', null, { 'x-test-user': '1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.models[0].status, 'available');
  assert.equal(r.data.models[0].defaultDuration, 30);
  assert.ok(!/flora|provider|keyId|run_|workspace|prj_|fake_secret/i.test(JSON.stringify(r)));
  assert.equal(h.stats.starts, 0);
});

test('parallel idempotent requests create and charge only once; changed body conflicts', async t => {
  const h = await routeFixture(t);
  const results = await Promise.all([h.generate(), h.generate()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 202]);
  assert.equal(results[0].data.taskId, results[1].data.taskId);
  assert.equal(h.stats.starts, 1);
  assert.equal(h.stats.counts, 1);
  assert.equal(h.stats.released, 2);
  assert.equal((await h.generate({ prompt: 'changed' })).status, 409);
  assert.equal((await h.generate({}, { 'Idempotency-Key': 'request-two' })).status, 429);
});

test('task polling enforces key/session ownership, sanitizes output and survives a fresh request', async t => {
  const h = await routeFixture(t);
  const created = await h.generate({ image: png });
  assert.equal(h.stats.uploads, 1);
  const path = `/api/videogen/tasks/${created.data.taskId}`;
  assert.equal((await h.call(path)).status, 401);
  assert.equal((await h.call(path, null, { 'X-Xclip-Key': 'other' })).status, 404);
  assert.equal((await h.call(path, null, { 'X-Xclip-Key': 'revoked', 'x-test-user': '1' })).status, 401);
  assert.equal(h.stats.polls, 0);
  const finished = await h.call(path, null, { 'X-Xclip-Key': 'owner' });
  assert.equal(finished.data.status, 'completed');
  assert.equal(finished.data.videoUrl, `/api/videogen/proxy-video?taskId=${created.data.taskId}`);
  assert.ok(!/flora|provider|secret|keyId|run_test/i.test(JSON.stringify(finished)));
  assert.equal((await h.call(path, null, { 'x-test-user': '1' })).data.status, 'completed');
  assert.equal(h.stats.polls, 1);
});

test('subscription, quota, revoked keys, and unknown Wan model are blocked before a paid call', async t => {
  const h = await routeFixture(t, { noSubscription: true });
  assert.equal((await h.generate()).status, 403);
  assert.equal((await h.generate({}, { 'X-Xclip-Key': 'revoked' })).status, 401);
  assert.equal(h.stats.starts, 0);
  const q = await routeFixture(t, { quotaUsed: 50 });
  assert.equal((await q.generate()).status, 429);
  assert.equal(q.stats.starts, 0);
  const a = await routeFixture(t);
  assert.equal((await a.generate({ model: 'wan-3.0-made-up' })).status, 400);
  assert.equal((await a.generate({}, { 'Idempotency-Key': '' })).status, 400);
  assert.equal((await a.generate({ model: 'kling-v2.6-pro' })).data.legacy, true);
  assert.equal(a.stats.starts, 0);
});

test('uncertain delivery stays pending, blocks new requests, and never regenerates during polling or retry', async t => {
  const h = await routeFixture(t, { startFailure: true, uncertain: true });
  const r = await h.generate();
  assert.equal(r.status, 202);
  assert.equal(r.data.status, 'pending');
  assert.ok(r.data.notice.includes('belum terkonfirmasi'));
  assert.equal((await h.generate()).status, 200);
  assert.equal((await h.generate({}, { 'Idempotency-Key': 'different' })).status, 409);
  assert.equal((await h.call(`/api/videogen/tasks/${r.data.taskId}`, null, { 'X-Xclip-Key': 'owner' })).data.status, 'pending');
  assert.equal(h.stats.starts, 1);
  assert.equal(h.stats.polls, 0);
});

test('definite submission failure is retained as failed; idempotent retry does not charge again', async t => {
  const h = await routeFixture(t, { startFailure: true });
  assert.equal((await h.generate()).status, 503);
  const retried = await h.generate();
  assert.equal(retried.data.status, 'failed');
  assert.equal(h.stats.starts, 1);
});

test('legacy workers and webhook cannot dispatch or mutate Wan tasks', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.ok(source.includes("if (row.model === 'wan-3.0-uncensored') continue"));
  assert.ok(source.includes("taskCheck.rows.some(task => task.model === 'wan-3.0-uncensored')"));
  assert.ok(source.indexOf("app.use(require('./server/wan-routes')") < source.indexOf("app.post('/api/videogen/proxy'"));
});

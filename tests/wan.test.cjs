const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { MODEL, ServiceError, validateInput, createWanProvider } = require('../server/wan-provider');
const wanRoutes = require('../server/wan-routes');
const {createGenerationLogger}=require('../server/generation-log');

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
  const events = [];
  const logger=createGenerationLogger({write:(_level,record)=>events.push(record)});
  const locks = new Map();
  const stats = { starts: 0, polls: 0, released: 0, uploads: 0, counts: 0, reservations: 0, refunds: 0, reservedAmounts: [], newStarts: 0, newPolls: 0, seedanceStarts: 0, seedancePolls: 0 };
  async function query(sql, p = []) {
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
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
      if (sql.includes("retry_data->>'runId' IS NOT NULL")) {
        if (opts.workerFailure) throw Object.assign(new Error('private SQL details'),{code:'42703'});
        return {rows:[...rows.values()].filter(r=>['pending','processing'].includes(r.status)&&r.retry_data.runId)};
      }
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
  const wallet = {
    assertReady() {},
    async reserve(_client, _userId, _taskId, price) {
      if (opts.noSubscription && !opts.activeSubscription) {
        const { WalletError } = require('../server/api-wallet');
        throw new WalletError(402, 'Saldo API tidak cukup.');
      }
      stats.reservations++;
      stats.reservedAmounts.push(price);
    },
    async finish(row, result) {
      if (opts.finishFailure) throw Object.assign(new Error('secret database message fake_secret'),{code:'42P08'});
      const current = rows.get(row.task_id);
      if (['completed','failed'].includes(current.status)) return structuredClone(current);
      if (result.status === 'failed' && current.retry_data.billing === 'wallet') stats.refunds++;
      Object.assign(current, { status: result.status, video_url: result.videoUrl });
      return structuredClone(current);
    },
  };
  const provider = {
    async context() { if (opts.unavailable) throw new ServiceError(503, 'Layanan sementara tidak tersedia.'); },
    async prepare() { return { keyId: 7, body: {} }; },
    async start() {
      stats.starts++;
      if (opts.startFailure) throw Object.assign(new ServiceError(503, 'Generasi sementara tidak tersedia.'),
        { deliveryUncertain: opts.uncertain });
      return 'run_test';
    },
    async poll() {
      stats.polls++;
      if (opts.pollFailure) throw Object.assign(new ServiceError(503,'Layanan sementara tidak tersedia.'),
        {diagnostic:{reason:'upstream_rate_limited',upstreamStatus:429}});
      return { status: opts.processing ? 'processing' : opts.failed ? 'failed' : 'completed',
      ...(opts.processing ? {progress:40} : {}),
      videoUrl: opts.failed ? null : 'https://media.flora.ai/a.mp4?secret=fake' }; },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: Number(req.headers['x-test-user']) || null }; next(); });
  const secondProvider = {
    ...provider, handlesImage: true,
    async context() { if(opts.newUnavailable) throw new ServiceError(503,'Layanan sementara tidak tersedia.'); },
    async start() { stats.newStarts++; return 'captured-workflow-id'; },
    async poll() { stats.newPolls++; return {status:'completed',videoUrl:'https://cdn.picsart.com/fake.mp4'}; },
  };
  const seedanceProvider = {
    ...secondProvider,
    async context() { if(opts.seedanceUnavailable) throw new ServiceError(503,'Layanan sementara tidak tersedia.'); },
    async start() { stats.seedanceStarts++; return 'seedance-workflow'; },
    async poll() { stats.seedancePolls++; return {status:'completed',videoUrl:'https://cdn.picsart.com/seedance.mp4'}; },
  };
  stats.seedance2Starts=0;stats.seedance2Polls=0;
  const seedance2Provider = {
    ...seedanceProvider,
    async start() {stats.seedance2Starts++;return 'seedance2-workflow';},
    async poll() {stats.seedance2Polls++;return {status:'completed',videoUrl:'https://cdn.picsart.com/seedance2.mp4'};},
  };
  const router = wanRoutes({ pool, provider, providers: {'wan-3.0':secondProvider,'seedance-2.5':seedanceProvider,'seedance-2.0':seedance2Provider}, wallet, logger, validateKey: async key =>
    key === 'revoked' ? null : { id: key === 'other' ? 2 : 1, user_id: key === 'other' ? 2 : 1,
      room_id: opts.noSubscription ? null : 1, has_subscription: !!opts.activeSubscription, is_admin: false },
    saveImage: async () => { stats.uploads++; return 'https://xclip.example/test.png'; } });
  app.use(router);
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
  return { rows, stats, call, generate, router, events };
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

test('paid API subscribers can use the Wan pool without a legacy generator room', async t => {
  const h = await routeFixture(t, { noSubscription: true, activeSubscription: true });
  assert.equal((await h.generate()).status, 202);
  assert.equal(h.stats.starts, 1);
  assert.equal(h.stats.reservations, 0);
});

test('parallel idempotent requests create and charge only once; changed body conflicts', async t => {
  const h = await routeFixture(t);
  const results = await Promise.all([h.generate(), h.generate()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 202]);
  assert.equal(results[0].data.taskId, results[1].data.taskId);
  assert.equal(h.stats.starts, 1);
  assert.equal(h.stats.counts, 1);
  assert.equal(h.stats.reservations, 1);
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

test('insufficient wallet, quota, revoked keys, and unknown Wan model are blocked before a paid call', async t => {
  const h = await routeFixture(t, { noSubscription: true });
  assert.equal((await h.generate()).status, 402);
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
  assert.equal(h.stats.reservations, 1);
  assert.equal(h.stats.refunds, 0);
});

test('definite submission failure is retained as failed; idempotent retry does not charge again', async t => {
  const h = await routeFixture(t, { startFailure: true });
  assert.equal((await h.generate()).status, 503);
  const retried = await h.generate();
  assert.equal(retried.data.status, 'failed');
  assert.equal(h.stats.starts, 1);
  assert.equal(h.stats.refunds, 1);
});

test('legacy workers and webhook cannot dispatch or mutate Wan tasks', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.ok(source.includes("if (row.model === 'wan-3.0-uncensored') continue"));
  assert.ok(source.includes("taskCheck.rows.some(task => task.model === 'wan-3.0-uncensored' || task.model === 'wan-3.0' || task.model === 'seedance-2.5' || task.model === 'seedance-2.0')"));
  assert.ok(source.includes("if (row.model === 'wan-3.0') continue"));
  assert.ok(source.includes("if (row.model === 'seedance-2.5') continue"));
  assert.ok(source.includes("if (row.model === 'seedance-2.0') continue"));
  assert.ok(source.indexOf("app.use(wanRouter)") < source.indexOf("app.post('/api/videogen/proxy'"));
});

test('Seedance 2.0 defaults to 15s, charges 5000 even with a subscription and uses only its adapter', async t => {
  const h=await routeFixture(t,{activeSubscription:true});
  const catalog=await h.call('/api/developer/models',null,{'X-Xclip-Key':'owner'});
  const model=catalog.data.models.find(m=>m.id==='seedance-2.0');
  assert.equal(model.pricePerVideo,5000);
  assert.equal(model.defaultDuration,15);
  assert.equal(model.minDuration,15);
  assert.equal(model.maxDuration,15);
  const made=await h.generate({model:'seedance-2.0'});
  assert.equal(made.status,202);
  assert.equal(made.data.model,'seedance-2.0');
  assert.deepEqual(h.stats.reservedAmounts,[5000]);
  assert.equal(h.stats.seedance2Starts,1);
  assert.equal(h.stats.starts+h.stats.newStarts+h.stats.seedanceStarts,0);
  assert.equal((await h.generate({model:'seedance-2.0'})).status,200);
  assert.equal(h.stats.seedance2Starts,1);
  assert.equal((await h.generate({model:'seedance-2.5'})).status,409);
  const done=await h.call(`/api/videogen/tasks/${made.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  assert.equal(done.data.model,'seedance-2.0');
  assert.equal(done.data.status,'completed');
  assert.equal(h.stats.seedance2Polls,1);
  assert.equal(h.stats.polls+h.stats.newPolls+h.stats.seedancePolls,0);
  assert.ok(done.data.videoUrl.startsWith('/api/videogen/proxy-video?taskId='));
  assert.ok(!/picsart|flora|workflow|seedance_2_0/i.test(JSON.stringify(done.data)));
});

test('Seedance uses its own adapter and 11000 wallet charge with protected output and idempotent replay', async t => {
  const h=await routeFixture(t,{activeSubscription:true});
  const made=await h.generate({model:'seedance-2.5',duration:30});
  assert.equal(made.status,202);
  assert.equal(made.data.model,'seedance-2.5');
  assert.deepEqual(h.stats.reservedAmounts,[11000]);
  assert.equal(h.stats.seedanceStarts,1);
  assert.equal(h.stats.starts+h.stats.newStarts,0);
  assert.equal((await h.generate({model:'seedance-2.5',duration:30})).status,200);
  assert.equal(h.stats.seedanceStarts,1);
  const done=await h.call(`/api/videogen/tasks/${made.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  assert.equal(done.data.status,'completed');
  assert.equal(done.data.model,'seedance-2.5');
  assert.equal(h.stats.seedancePolls,1);
  assert.equal(h.stats.polls+h.stats.newPolls,0);
  assert.ok(done.data.videoUrl.startsWith('/api/videogen/proxy-video?taskId='));
  assert.ok(!/picsart|flora|workflow/i.test(JSON.stringify(done.data)));
});

test('Seedance unavailable does not hide Wan or silently fall back to another model', async t => {
  const h=await routeFixture(t,{seedanceUnavailable:true});
  const catalog=await h.call('/api/developer/models',null,{'X-Xclip-Key':'owner'});
  assert.equal(catalog.status,200);
  assert.equal(catalog.data.models.find(m=>m.id==='seedance-2.5').status,'unavailable');
  assert.equal(catalog.data.models.find(m=>m.id==='seedance-2.0').status,'unavailable');
  assert.equal(catalog.data.models.find(m=>m.id==='wan-3.0').status,'available');
  assert.equal((await h.generate({model:'seedance-2.5'})).status,503);
  assert.equal((await h.generate({model:'seedance-2.0'})).status,503);
  assert.equal((await h.generate({model:'seedance-2.5-fake'})).status,400);
  assert.equal(h.stats.starts+h.stats.newStarts+h.stats.seedanceStarts,0);
  assert.equal(h.stats.reservations,0);
});

test('both two-second and thirty-second videos reserve one fixed-price generation', async t => {
  for (const duration of [2,30]) {
    const h=await routeFixture(t);
    assert.equal((await h.generate({duration})).status,202);
    assert.equal(h.stats.reservations,1);
    assert.equal([...h.rows.values()][0].retry_data.price,6000);
  }
});

test('new Wan routes to its own adapter, charges 6500 even with a legacy subscription and replays without dispatch', async t => {
  const h=await routeFixture(t,{activeSubscription:true});
  const created=await h.generate({model:'wan-3.0',duration:30});
  assert.equal(created.status,202);
  assert.equal(created.data.model,'wan-3.0');
  assert.deepEqual(h.stats.reservedAmounts,[6500]);
  assert.equal(h.stats.newStarts,1);
  assert.equal(h.stats.starts,0);
  assert.equal((await h.generate({model:'wan-3.0',duration:30})).status,200);
  assert.equal(h.stats.newStarts,1);
  assert.equal((await h.generate()).status,409);
  const done=await h.call(`/api/videogen/tasks/${created.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  assert.equal(done.data.status,'completed');
  assert.equal(done.data.model,'wan-3.0');
  assert.equal(h.stats.newPolls,1);
  assert.equal(h.stats.polls,0);
  assert.ok(!/picsart|flora|captured-workflow-id/i.test(JSON.stringify(done.data)));
  assert.equal(done.data.videoUrl,`/api/videogen/proxy-video?taskId=${created.data.taskId}`);
});

test('model catalog reports independent availability and never sends a missing model to a different provider', async t => {
  const h=await routeFixture(t,{newUnavailable:true});
  const catalog=await h.call('/api/developer/models',null,{'X-Xclip-Key':'owner'});
  assert.equal(catalog.status,200);
  assert.equal(catalog.data.models.find(m=>m.id===MODEL).status,'available');
  assert.equal(catalog.data.models.find(m=>m.id==='wan-3.0').status,'unavailable');
  assert.equal((await h.generate({model:'wan-3.0'})).status,503);
  assert.equal(h.stats.starts,0);
  assert.equal(h.stats.newStarts,0);
  assert.equal(h.stats.reservations,0);
});

test('generation lifecycle logs queued, accepted, completed and replay without secret content', async t => {
  const h=await routeFixture(t);
  const created=await h.generate();
  await h.generate();
  await h.call(`/api/videogen/tasks/${created.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  await h.call(`/api/videogen/tasks/${created.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  for(const name of ['request_received','task_queued','generation_dispatch_started',
    'generation_accepted','request_replayed','task_completed','task_status_read']) {
    assert.ok(h.events.some(e=>e.event===name),name);
  }
  assert.equal(h.events.filter(e=>e.event==='generation_dispatch_started').length,1);
  assert.equal(h.stats.starts,1);
  assert.ok(!/flora|secret=|run_test|prompt|authorization/i.test(JSON.stringify(h.events)));
});

test('worker reports idle heartbeat and progress without making another generation',async t=>{
  const h=await routeFixture(t,{processing:true});
  await h.router.reconcile();
  assert.equal(h.events.at(-1).event,'worker_heartbeat');
  assert.equal(h.events.at(-1).checkedTasks,0);
  await h.generate();
  const cycle=h.router.reconcile();
  await h.router.reconcile();
  assert.ok(h.events.some(e=>e.event==='worker_heartbeat'&&e.stage==='worker_busy'));
  await cycle;
  assert.equal(h.events.at(-1).checkedTasks,1);
  assert.equal(h.events.at(-1).failedChecks,0);
  assert.ok(h.events.some(e=>e.event==='task_in_progress'&&e.progress===40));
  assert.equal(h.stats.starts,1);
});

test('worker logs SQL type failure with stage and keeps public errors sanitized',async t=>{
  const h=await routeFixture(t,{finishFailure:true});
  const created=await h.generate();
  await h.router.reconcile();
  const failure=h.events.find(e=>e.event==='task_poll_failed');
  assert.equal(failure.code,'42P08');
  assert.equal(failure.stage,'persist_task_status');
  assert.equal(failure.reason,'database_parameter_type_conflict');
  assert.equal(h.events.at(-1).failedChecks,1);
  const status=await h.call(`/api/videogen/tasks/${created.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  assert.equal(status.status,503);
  assert.ok(!/42P08|fake_secret|database|diagnostic/i.test(JSON.stringify(status.data)));
  assert.ok(!/fake_secret|secret database/i.test(JSON.stringify(h.events)));
  assert.equal(h.stats.starts,1);
});

test('worker logs upstream HTTP failures and query failures rather than swallowing them',async t=>{
  const h=await routeFixture(t,{pollFailure:true});
  await h.generate();await h.router.reconcile();
  const failure=h.events.find(e=>e.event==='task_poll_failed');
  assert.equal(failure.upstreamStatus,429);
  assert.equal(failure.reason,'upstream_rate_limited');
  assert.equal(failure.stage,'poll_upstream');
  const q=await routeFixture(t,{workerFailure:true});
  await q.router.reconcile();
  assert.ok(q.events.some(e=>e.event==='worker_failed'&&e.code==='42703'));
  assert.equal(q.events.at(-1).failedChecks,1);
});

test('uncertain dispatch is logged without retry or leaking provider response',async t=>{
  const h=await routeFixture(t,{startFailure:true,uncertain:true});
  await h.generate();await h.generate();
  assert.ok(h.events.some(e=>e.event==='generation_delivery_uncertain'));
  assert.equal(h.stats.starts,1);assert.equal(h.stats.refunds,0);
  const f=await routeFixture(t,{startFailure:true});
  await f.generate();
  assert.ok(f.events.some(e=>e.event==='generation_dispatch_failed'));
  assert.ok(f.events.some(e=>e.event==='wallet_reservation_refunded'&&e.amount===6000));
});

test('confirmed video failure logs refunded state, without dispatching a second video',async t=>{
  const h=await routeFixture(t,{failed:true});
  const created=await h.generate();
  await h.call(`/api/videogen/tasks/${created.data.taskId}`,null,{'X-Xclip-Key':'owner'});
  const failure=h.events.find(e=>e.event==='task_failed');
  assert.equal(failure.level,'error');
  assert.equal(failure.walletState,'refunded');
  assert.equal(failure.reason,'upstream_generation_failed');
  assert.equal(h.stats.refunds,1);
  assert.equal(h.stats.starts,1);
});

test('adapter diagnostic categories preserve upstream auth and timeout causes without raw payloads',async()=>{
  for(const [status,code,reason] of [[401,undefined,'upstream_auth_failed'],
    [429,undefined,'upstream_rate_limited'],[undefined,'ETIMEDOUT','upstream_timeout']]){
    const h=providerFixture({request:async()=>{
      throw Object.assign(new Error('raw private secret URL'),{code,
        response:status?{status,data:{secret:'private upstream payload'}}:undefined,
        config:{headers:{Authorization:'Bearer fake_secret'}}});
    }});
    await assert.rejects(h.provider.context(),e=>{
      assert.equal(e.diagnostic.reason,reason);
      assert.ok(!/fake_secret|private|payload|Authorization/i.test(JSON.stringify(e)));
      return e.status===503;
    });
    assert.equal(h.calls.length,1);
  }
});

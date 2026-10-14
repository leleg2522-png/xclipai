const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const { createUserKey } = require('../server/xclip-key-service');
const developerRouter = require('../server/developer');

async function withServer(pool, work) {
  const app = express();
  // Test-only sessions; never mounted by the application.
  app.use((req, _res, next) => {
    req.session = { userId: req.headers['x-test-user'] ? Number(req.headers['x-test-user']) : null };
    next();
  });
  app.use(developerRouter(pool));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('anonymous callers cannot read portal data or upstream credentials', async () => {
  await withServer({ query() { throw new Error('must not query'); } }, async base => {
    const response = await fetch(base + '/api/developer/overview');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('overview is scoped to session owner and never returns provider secrets', async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('FROM xclip_api_keys')) {
      return { rows: [
        { id: 1, status: 'active', api_key: 'xclip_test_only', requests_count: 4 },
        { id: 2, status: 'revoked', requests_count: 6 },
      ] };
    }
    throw new Error('Portal must not query provider storage');
  } };
  await withServer(pool, async base => {
    const response = await fetch(base + '/api/developer/overview', { headers: { 'x-test-user': '42' } });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes('SECRET_MUST_NOT_LEAK'));
    const data = JSON.parse(text);
    assert.equal(data.totalRequests, 10);
    assert.equal(data.hasLifetimeKey, true);
    assert.deepEqual(Object.keys(data).sort(), ['hasLifetimeKey', 'keys', 'totalRequests']);
    assert.ok(!/picsart|flora|freepik|provider/i.test(text));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [42]);
  });
});

test('overview does not require provider storage; database failures are not fake zeros', async () => {
  await withServer({ async query() {
    return { rows: [] };
  } }, async base => {
    const data = await (await fetch(base + '/api/developer/overview', { headers: { 'x-test-user': '3' } })).json();
    assert.equal(data.totalRequests, 0);
    assert.equal(data.providers, undefined);
    assert.equal(data.hasLifetimeKey, false);
  });
  await withServer({ async query() { throw Object.assign(new Error('secret detail'), { code: 'TEST_DB_FAILURE' }); } }, async base => {
    const response = await fetch(base + '/api/developer/overview', { headers: { 'x-test-user': '3' } });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('secret detail'));
  });
});

function keyPool(existing = new Map()) {
  const locks = new Map();
  let released = 0;
  return { existing, get released() { return released; }, async connect() {
    let unlock;
    return {
      async query(sql, params) {
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = locks.get(params[1]) || Promise.resolve();
          locks.set(params[1], new Promise(resolve => { unlock = resolve; }));
          await previous;
        } else if (sql.startsWith('SELECT id')) {
          return { rows: existing.has(params[0]) ? [existing.get(params[0])] : [] };
        } else if (sql.includes('INSERT INTO')) {
          const row = { id: existing.size + 1, api_key: params[1], label: params[2] };
          existing.set(params[0], row);
          return { rows: [row] };
        } else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (unlock) { unlock(); unlock = null; }
        }
        return { rows: [] };
      },
      release() { released++; },
    };
  } };
}

test('simultaneous creates yield one lifetime key and release both clients', async () => {
  const pool = keyPool();
  const results = await Promise.allSettled([
    createUserKey(pool, 1, 'First'), createUserKey(pool, 1, 'Second'),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'KEY_ALREADY_EXISTS');
  assert.match(results.find(r => r.status === 'fulfilled').value.api_key, /^xclip_[0-9a-f]{48}$/);
  assert.equal(pool.released, 2);
});

test('revoked keys cannot be replaced; different users receive distinct keys', async () => {
  const pool = keyPool(new Map([[1, { id: 1, status: 'revoked' }]]));
  await assert.rejects(createUserKey(pool, 1, 'Replacement'), { code: 'KEY_ALREADY_EXISTS' });
  const a = await createUserKey(pool, 2, 'A');
  const b = await createUserKey(pool, 3, 'B');
  assert.notEqual(a.api_key, b.api_key);
});

function loadViews() {
  const iconsSource = fs.readFileSync('client/src/developer-icons.js', 'utf8').replace('export const icons =', '');
  const icons = JSON.parse(iconsSource.trim().replace(/;$/, ''));
  const source = fs.readFileSync('client/src/developer-views.js', 'utf8')
    .replace(/^import .*;\n/, '').replace(/^export /gm, '');
  return vm.runInNewContext(source + '\n({authView,portalView,curlExample});', { icons, Intl, Date });
}

function browserHarness() {
  const views = loadViews();
  const handlers = {};
  const root = {
    innerHTML: '', querySelectorAll() { return []; },
    addEventListener(name, handler) { handlers[name] = handler; },
  };
  const calls = [];
  let payments = [];
  const fakeFetch = async (path, options = {}) => {
    calls.push({ path, options });
    let data;
    if (path === '/api/auth/me') data = { user: null };
    if (path === '/api/auth/register') data = { success: true };
    if (path === '/api/auth/login') data = { user: { id: 1, username: '<script>unsafe</script>' } };
    if (path === '/api/auth/logout') data = { success: true };
    if (path === '/api/developer/overview') data = {
      keys: [], hasLifetimeKey: false, totalRequests: 0,
      providers: [{ name: 'Picsart', configured: true, connected: false }], generationProvider: 'Freepik',
    };
    if (path === '/api/subscription/status') data = { hasSubscription: false };
    if (path === '/api/subscription/plans') data = { plans: [{ id: 1, name: '1 Hari', price_idr: 30000, duration_days: 1 }] };
    if (path === '/api/payments/my') data = { payments };
    if (path === '/api/developer/models') data = { models: [{ id: 'wan-3.0-uncensored', status: 'available' }] };
    if (path === '/api/payments/submit') {
      payments = [{ package: '1 Hari', amount: 30000, status: 'pending' }];
      data = { success: true, message: 'Menunggu verifikasi' };
    }
    assert.ok(data, `unexpected request ${path}`);
    return { ok: true, status: 200, async json() { return data; } };
  };
  class FormDataStub {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? null; }
  }
  const source = fs.readFileSync('client/src/developer.js', 'utf8')
    .replace(/^import .*;\n/, '').replace(/\nstart\(\);\s*$/, '');
  const controller = vm.runInNewContext(source + '\n({start,state,render,isBusy:()=>busy});', {
    ...views, document: { getElementById(id) { return id === 'developer-app' ? root : null; } },
    navigator: {}, fetch: fakeFetch, AbortController, setTimeout, clearTimeout, FormData: FormDataStub,
  });
  const submit = (id, values) => handlers.submit({ preventDefault() {}, target: { id, values } });
  const click = action => handlers.click({ target: { closest() { return { dataset: { action } }; } } });
  const settle = async () => {
    for (let n = 0; n < 30 && controller.isBusy(); n++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.isBusy(), false);
  };
  return { controller, root, calls, submit, click, settle };
}

test('signup -> login -> portal -> logout uses real endpoints and escapes account data', async () => {
  const h = browserHarness();
  await h.controller.start();
  assert.ok(h.root.innerHTML.includes('Masuk ke portal'));
  assert.ok(h.root.innerHTML.includes('tidak perlu daftar ulang'));
  h.click('switch-auth');
  assert.ok(h.root.innerHTML.includes('Daftar developer'));
  assert.ok(!h.root.innerHTML.includes('id="topup"'));
  h.submit('auth-form', { username: 'developer', email: 'dev@example.test', password: 'password123', confirm: 'wrong' });
  await h.settle();
  assert.ok(h.root.innerHTML.includes('Konfirmasi kata sandi tidak cocok'));
  assert.equal(h.calls.length, 1);
  h.submit('auth-form', { username: 'developer', email: 'dev@example.test', password: 'password123', confirm: 'password123' });
  await h.settle();
  assert.equal(h.controller.state.user, null);
  assert.equal(h.controller.state.authMode, 'login');
  assert.equal(JSON.parse(h.calls.find(c => c.path.endsWith('register')).options.body).portal, true);
  h.submit('auth-form', { email: 'dev@example.test', password: 'password123' });
  await h.settle();
  assert.ok(h.root.innerHTML.includes('id="topup"'));
  assert.ok(!/picsart|flora|freepik/i.test(h.root.innerHTML));
  assert.ok(h.root.innerHTML.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!h.root.innerHTML.includes('<script>unsafe'));
  h.click('logout');
  await h.settle();
  assert.ok(!h.root.innerHTML.includes('id="topup"'));
  assert.equal(h.controller.state.overview, null);
});

test('top up submits proof and remains pending, not an invented balance increase', async () => {
  const h = browserHarness();
  await h.controller.start();
  h.controller.state.authMode = 'login';
  h.submit('auth-form', { email: 'dev@example.test', password: 'password123' });
  await h.settle();
  h.submit('payment-form', { planId: '1', proof: { size: 10, type: 'image/png' } });
  await h.settle();
  assert.ok(h.calls.some(c => c.path === '/api/payments/submit'));
  assert.ok(h.root.innerHTML.includes('Menunggu verifikasi pembayaran sebelumnya'));
  assert.equal(h.controller.state.payments[0].status, 'pending');
});

test('revoked state has no create button and docs describe the Wan API contract', () => {
  const { portalView, curlExample } = loadViews();
  const h = browserHarness();
  const s = h.controller.state;
  s.user = { username: 'dev' };
  s.overview = { keys: [{ status: 'revoked', api_key: 'hidden' }], hasLifetimeKey: true, totalRequests: 3, providers: [], generationProvider: 'Freepik' };
  const html = portalView(s);
  assert.ok(html.includes('Wan 3.0 Uncensored'));
  assert.ok(html.includes('VIDEO · UNCENSORED'));
  assert.ok(html.includes('href="#model"'));
  assert.ok(!/generator|Ke generator|Buka generator/i.test(html));
  assert.ok(html.includes('Belum tersedia'));
  assert.ok(!/flora|picsart|freepik/i.test(html));
  assert.ok(html.includes('API key telah dinonaktifkan'));
  assert.ok(!html.includes('id="key-form"'));
  assert.ok(!html.includes('hidden</code>'));
  assert.ok(curlExample('generate').includes('"model": "wan-3.0-uncensored"'));
  assert.ok(curlExample('generate').includes('"duration": 30'));
  assert.ok(curlExample('generate').includes('"resolution": "480p"'));
  assert.ok(curlExample('generate').includes('Idempotency-Key'));
  s.models = [{ id: 'wan-3.0-uncensored', status: 'available' }];
  assert.ok(portalView(s).includes('Tersedia'));
  assert.ok(portalView(s).includes('480p'));
  assert.ok(curlExample('status').includes('/api/videogen/tasks/<taskId>'));
});

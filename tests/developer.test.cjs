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
  return vm.runInNewContext(source + '\n({authView,portalView,curlExample,generationHistoryContent,modelsView,paymentButtonState});',
    { icons, Intl, Date, URL, window: { location: { origin: 'https://xclip.test' } } });
}

function browserHarness(overrides = {}) {
  const { interceptFetch, ...runtimeOverrides } = overrides;
  const views = loadViews();
  const handlers = {};
  const root = {
    innerHTML: '', querySelectorAll() { return []; },
    addEventListener(name, handler) { handlers[name] = handler; },
  };
  const calls = [];
  let payments = [];
  let invoice = null;
  const fakeFetch = async (path, options = {}) => {
    calls.push({ path, options });
    let data;
    if (path === '/api/auth/me') data = { user: null };
    if (path === '/api/auth/register') data = { success: true };
    if (path === '/api/auth/login') data = { user: { id: 1, username: '<script>unsafe</script>' } };
    if (path === '/api/auth/logout') data = { success: true };
    if (path.startsWith('/api/developer/generations')) data = { tasks: [], page: 1, hasMore: false };
    if (path === '/api/developer/overview') data = {
      keys: [], hasLifetimeKey: false, totalRequests: 0,
      providers: [{ name: 'Picsart', configured: true, connected: false }], generationProvider: 'Freepik',
    };
    if (path === '/api/subscription/status') data = { hasSubscription: false };
    if (path === '/api/developer/wallet') data = { balance: invoice?.status === 'paid' ? 100000 : 0,
      reserved: 0, videoPrice: 6000, minimumTopup: 100000, maximumTopup: 100000000, expires: false };
    if (path === '/api/subscription/plans') data = { plans: [{ id: 1, name: '1 Hari', price_idr: 30000, duration_days: 1 }] };
    if (path === '/api/payments/my') data = { payments };
    if (path === '/api/payments/klikqris/config') data = { available: true, sandbox: false };
    if (path === '/api/payments/klikqris/current') data = { invoice };
    if (path === '/api/developer/models') data = { models: [{ id: 'wan-3.0-uncensored', status: 'available' }] };
    if (path === '/api/payments/klikqris/create') {
      invoice = { id: 'xq_test', provider: 'klikqris', billing_type: 'wallet', package: 'Top up saldo API', amount: 100000,
        total_amount: 100021, status: 'pending', qr_url: '/api/payments/klikqris/xq_test/qr',
        expires_at: '2030-01-01T00:00:00Z' };
      payments = [invoice];
      data = { success: true, invoice };
    }
    if (path === '/api/payments/klikqris/xq_test') {
      invoice = { ...invoice, status: 'paid', qr_url: null };
      payments = [invoice];
      data = { invoice };
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
  const controller = vm.runInNewContext(source + '\n({start,state,render,loadGenerationHistory,checkPayment,isBusy:()=>busy||state.paymentBusy});', {
    ...views, document: { querySelector() { return null; }, getElementById(id) { return id === 'developer-app' ? root : null; } },
    navigator: {}, fetch: interceptFetch ? (path, options) => interceptFetch(path, options, fakeFetch) : fakeFetch,
    AbortController, setTimeout, clearTimeout, FormData: FormDataStub,
    ...runtimeOverrides,
  });
  const submit = (id, values) => handlers.submit({ preventDefault() {}, target: { id, values } });
  const click = action => handlers.click({ target: { closest() { return { dataset: { action } }; } } });
  const settle = async () => {
    for (let n = 0; n < 30 && controller.isBusy(); n++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.isBusy(), false);
  };
  return { controller, root, calls, submit, click, settle };
}

test('QR creation button distinguishes readiness, active requests and existing invoices', () => {
  const {paymentButtonState,portalView}=loadViews();
  const s=browserHarness().controller.state;
  s.user={id:1,username:'dev'};
  s.wallet={balance:0,reserved:0,minimumTopup:100000,maximumTopup:100000000};
  s.paymentConfig={available:true};
  assert.equal(paymentButtonState(s).disabled,false);
  s.paymentCreating=true;
  assert.equal(paymentButtonState(s).busy,true);
  assert.ok(paymentButtonState(s).label.includes('Sedang membuat'));
  s.paymentCreating=false;
  s.paymentLoading=true;
  assert.equal(paymentButtonState(s).busy,true);
  s.paymentLoading=false;
  s.paymentConfig=null;
  assert.equal(paymentButtonState(s).busy,false);
  assert.equal(paymentButtonState(s).disabled,true);
  assert.ok(portalView(s).includes('Pembayaran belum siap'));
  assert.ok(portalView(s).includes('Perbarui pembayaran'));
  s.checkout={status:'pending'};
  assert.equal(paymentButtonState(s).busy,false);
  assert.ok(paymentButtonState(s).label.includes('tagihan aktif'));
  s.checkout={status:'uncertain'};
  assert.equal(paymentButtonState(s).busy,false);
  assert.ok(paymentButtonState(s).label.includes('perlu diperiksa'));
  s.checkout=null;
  s.checkoutError='Gateway belum tersedia';
  assert.equal(paymentButtonState(s).reason,s.checkoutError);
});

test('QR creating state is visible only during the request and resets when it finishes', async () => {
  let release;
  const h=browserHarness({interceptFetch(path,options,next) {
    if(path==='/api/payments/klikqris/create') return new Promise(resolve=>{release=()=>resolve(next(path,options));});
    return next(path,options);
  }});
  h.submit('auth-form',{email:'dev@test.example',password:'password'});await h.settle();
  h.submit('payment-form',{amount:'100000'});
  assert.equal(h.controller.state.paymentCreating,true);
  assert.equal(loadViews().paymentButtonState(h.controller.state).busy,true);
  release();await h.settle();
  assert.equal(h.controller.state.paymentCreating,false);
  assert.equal(loadViews().paymentButtonState(h.controller.state).busy,false);
});

test('slow video catalog and generation history cannot hold login or QR creation busy', async () => {
  const pending=[];
  const h=browserHarness({interceptFetch(path,options,next) {
    if(path==='/api/developer/models'||path.startsWith('/api/developer/generations')) {
      return new Promise(resolve=>pending.push(()=>resolve({ok:true,status:200,json:async()=>path.includes('/models')
        ?{models:[]}:{tasks:[],page:1,hasMore:false}})));
    }
    return next(path,options);
  }});
  try {
    h.submit('auth-form',{email:'dev@test.example',password:'password'});
    await h.settle();
    assert.ok(h.root.innerHTML.includes('Buat QRIS pembayaran'));
    h.submit('payment-form',{amount:'100000'});
    await h.settle();
    assert.equal(h.controller.state.checkout.status,'pending');
    assert.ok(h.root.innerHTML.includes('id="qris-image"'));
    assert.equal(h.calls.filter(c=>c.path==='/api/payments/klikqris/create').length,1);
    assert.equal(h.calls.filter(c=>c.path==='/api/payments/klikqris/current').length,1);
    await h.controller.checkPayment();
    assert.equal(h.controller.state.checkout.status,'paid');
    assert.equal(h.controller.state.wallet.balance,100000);
  } finally {pending.forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));}
});

test('unchanged automatic payment polls do not redraw the portal or reload the QR image', async () => {
  let h;
  h=browserHarness({interceptFetch(path,options,next) {
    if(path==='/api/payments/klikqris/xq_test') {
      return Promise.resolve({ok:true,status:200,json:async()=>({invoice:structuredClone(h.controller.state.checkout)})});
    }
    return next(path,options);
  }});
  h.submit('auth-form',{email:'dev@test.example',password:'password'});await h.settle();
  h.submit('payment-form',{amount:'100000'});await h.settle();
  let html=h.root.innerHTML,writes=0;
  Object.defineProperty(h.root,'innerHTML',{get:()=>html,set:value=>{writes++;html=value;}});
  await h.controller.checkPayment(true);
  await h.controller.checkPayment(true);
  assert.equal(writes,0);
  assert.equal(h.controller.state.checkout.status,'pending');
});

test('payment creation and checking remain usable while an unrelated account action is waiting', async () => {
  let stall = false, release;
  const h = browserHarness({ interceptFetch(path, options, next) {
    if (stall && path === '/api/developer/overview') return new Promise(resolve => {
      release = () => resolve(next(path, options));
    });
    return next(path, options);
  } });
  h.submit('auth-form', { email: 'dev@test.example', password: 'password' }); await h.settle();
  stall = true;
  h.click('refresh');
  assert.equal(h.controller.state.actionBusy, true);
  h.submit('payment-form', { amount: '100000' });
  for (let i = 0; i < 20 && h.controller.state.paymentBusy; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.controller.state.checkout.status, 'pending');
  assert.equal(h.controller.state.actionBusy, true);
  h.click('payment-check');
  for (let i = 0; i < 20 && h.controller.state.paymentBusy; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.controller.state.checkout.status, 'paid');
  assert.equal(h.controller.state.paymentBusy, false);
  release(); await h.settle();
});

test('payment refresh only reloads financial data, not the account or video providers', async () => {
  const h = browserHarness();
  h.submit('auth-form', { email: 'dev@test.example', password: 'password' }); await h.settle();
  const start = h.calls.length;
  h.click('payment-refresh'); await h.settle();
  assert.deepEqual(h.calls.slice(start).map(call => call.path).sort(), [
    '/api/developer/wallet', '/api/payments/klikqris/config',
    '/api/payments/klikqris/current', '/api/payments/my',
  ]);
  assert.ok(h.root.innerHTML.includes('Data pembayaran berhasil diperbarui.'));
});

test('payment startup 503 recovers automatically with read-only requests, never a repeated QR create', async () => {
  let ready = false, retry;
  const h = browserHarness({
    setTimeout(fn, delay) {
      if (delay === 5000) { retry = fn; return { unref() {} }; }
      return setTimeout(fn, delay);
    },
    interceptFetch(path, options, next) {
      if (!ready && path === '/api/payments/klikqris/config') return Promise.resolve({
        ok: false, status: 503, json: async () => ({
          error: 'Layanan pembayaran sedang disiapkan.', code: 'PAYMENT_INITIALIZING',
        }),
      });
      return next(path, options);
    },
  });
  h.submit('auth-form', { email: 'dev@test.example', password: 'password' }); await h.settle();
  assert.equal(loadViews().paymentButtonState(h.controller.state).disabled, true);
  assert.ok(h.root.innerHTML.includes('memeriksa ulang otomatis'));
  assert.equal(typeof retry, 'function');
  const start = h.calls.length;
  ready = true;
  retry(); await h.settle();
  assert.equal(loadViews().paymentButtonState(h.controller.state).disabled, false);
  assert.ok(h.calls.slice(start).every(call => !call.options.method || call.options.method === 'GET'));
  assert.ok(!h.calls.some(call => call.path === '/api/payments/klikqris/create'));
});

test('manual pending checks give visible confirmation and check failures do not poison readiness', async () => {
  let fail = false, h;
  h = browserHarness({ interceptFetch(path, options, next) {
    if (path === '/api/payments/klikqris/xq_test') return Promise.resolve({
      ok: !fail, status: fail ? 502 : 200,
      json: async () => fail ? { error: 'Status belum dapat diperiksa.' }
        : { invoice: structuredClone(h.controller.state.checkout) },
    });
    return next(path, options);
  } });
  h.submit('auth-form', { email: 'dev@test.example', password: 'password' }); await h.settle();
  h.submit('payment-form', { amount: '100000' }); await h.settle();
  h.click('payment-check'); await h.settle();
  assert.ok(h.root.innerHTML.includes('Status berhasil diperiksa: belum ada pembayaran'));
  fail = true;
  h.click('payment-check'); await h.settle();
  assert.equal(h.controller.state.paymentChecking, false);
  assert.ok(h.root.innerHTML.includes('Status belum dapat diperiksa.'));
  assert.equal(h.controller.state.checkoutError, '');
  fail = false;
  h.click('payment-check'); await h.settle();
  assert.equal(h.controller.state.paymentStatusError, '');
  assert.ok(h.root.innerHTML.includes('Status berhasil diperiksa: belum ada pembayaran'));
});

test('manual checks join an automatic check in progress rather than silently ignoring the click', async () => {
  let release, h;
  h = browserHarness({ interceptFetch(path, options, next) {
    if (path === '/api/payments/klikqris/xq_test') return new Promise(resolve => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({
        invoice: structuredClone(h.controller.state.checkout),
      }) });
    });
    return next(path, options);
  } });
  h.submit('auth-form', { email: 'dev@test.example', password: 'password' }); await h.settle();
  h.submit('payment-form', { amount: '100000' }); await h.settle();
  const automatic = h.controller.checkPayment(true);
  h.click('payment-check');
  release(); await automatic; await h.settle();
  assert.ok(h.root.innerHTML.includes('Status berhasil diperiksa: belum ada pembayaran'));
  assert.equal(h.controller.state.paymentChecking, false);
});

test('a missed payment POST response recovers the invoice without reissuing the charge', async () => {
  const h=browserHarness({async interceptFetch(path,options,next) {
    if(path==='/api/payments/klikqris/create') {
      await next(path,options);
      throw new TypeError('Failed to fetch');
    }
    return next(path,options);
  },console:{warn(){}}});
  h.submit('auth-form',{email:'dev@test.example',password:'password'});await h.settle();
  h.submit('payment-form',{amount:'100000'});await h.settle();
  assert.equal(h.controller.state.checkout.status,'pending');
  assert.ok(h.root.innerHTML.includes('id="qris-image"'));
  assert.equal(h.calls.filter(c=>c.path==='/api/payments/klikqris/create').length,1);
  assert.equal(h.calls.filter(c=>c.path==='/api/payments/klikqris/current').length,2);
  assert.ok(h.controller.state.paymentAttempt.key);
});

test('a timed-out QR creation and failed recovery release busy state with explicit retry guidance', async () => {
  let fail=false;
  const h=browserHarness({async interceptFetch(path,options,next) {
    if(fail && ['/api/payments/klikqris/create','/api/payments/klikqris/current'].includes(path)) {
      throw Object.assign(new Error('aborted'),{name:'AbortError'});
    }
    return next(path,options);
  }});
  h.submit('auth-form',{email:'dev@test.example',password:'password'});await h.settle();
  fail=true;
  h.submit('payment-form',{amount:'100000'});await h.settle();
  assert.equal(h.controller.isBusy(),false);
  assert.equal(h.controller.state.paymentCreating,false);
  assert.equal(h.controller.state.paymentLoading,false);
  assert.ok(h.root.innerHTML.includes('Server terlalu lama merespons'));
  assert.ok(h.root.innerHTML.includes('jangan membuat pembayaran ganda'));
  assert.equal(h.controller.state.checkout,null);
  assert.ok(h.controller.state.paymentAttempt.key);
});
test('network failures display actionable preview help, not an incorrect-password claim', async () => {
  const h = browserHarness({
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    console: { warn() {} },
  });
  await h.controller.start();
  assert.ok(h.root.innerHTML.includes('Tidak dapat terhubung ke server'));
  assert.ok(h.root.innerHTML.includes('tab baru'));
  assert.equal(h.controller.state.user, null);
});

test('legacy worker is released with one guarded reload before authentication requests', async () => {
  const entries = new Map();
  let reloads = 0;
  let unregisters = 0;
  const h = browserHarness({
    URL, navigator: { serviceWorker: {
      controller: { scriptURL: 'https://app.example.test/sw.js' },
      async getRegistrations() { return [{
        active: { scriptURL: 'https://app.example.test/sw.js' },
        async unregister() { unregisters++; return true; },
      }]; },
    } },
    sessionStorage: {
      getItem(key) { return entries.get(key); },
      setItem(key, value) { entries.set(key, value); },
      removeItem(key) { entries.delete(key); },
    },
    location: { reload() { reloads++; } },
  });
  await h.controller.start();
  assert.equal(reloads, 1);
  assert.equal(unregisters, 1);
  assert.equal(h.calls.length, 0);
  await h.controller.start();
  assert.equal(reloads, 1);
  assert.equal(h.calls[0].path, '/api/auth/me');
});

test('non-JSON gateway errors are handled without exposing server HTML', async () => {
  const h = browserHarness({
    fetch: async () => ({ ok: false, status: 502, async json() { throw new SyntaxError('private gateway HTML'); } }),
  });
  await h.controller.start();
  assert.ok(h.root.innerHTML.includes('HTTP 502'));
  assert.ok(!h.root.innerHTML.includes('private gateway HTML'));
});

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

test('top up creates dynamic KlikQRIS and confirms server status without proof upload or invented balance', async () => {
  const h = browserHarness();
  await h.controller.start();
  h.controller.state.authMode = 'login';
  h.submit('auth-form', { email: 'dev@example.test', password: 'password123' });
  await h.settle();
  h.submit('payment-form', { amount: '100000' });
  await h.settle();
  const create = h.calls.find(c => c.path === '/api/payments/klikqris/create');
  assert.ok(create);
  assert.ok(create.options.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(create.options.body), { amount: 100000 });
  assert.ok(!h.root.innerHTML.includes('type="file"'));
  assert.ok(h.root.innerHTML.includes('Masih ada tagihan aktif'));
  assert.ok(h.root.innerHTML.includes('100.021'));
  assert.ok(h.root.innerHTML.includes('tanpa masa aktif'));
  assert.ok(!h.root.innerHTML.includes('1 Hari'));
  assert.equal(h.controller.state.wallet.balance, 0);
  assert.equal(h.controller.state.payments[0].status, 'pending');
  h.click('payment-check');
  await h.settle();
  assert.equal(h.controller.state.checkout.status, 'paid');
  assert.ok(h.root.innerHTML.includes('Pembayaran dikonfirmasi'));
  assert.equal(h.controller.state.wallet.balance, 100000);
});

test('existing daily invoices are clearly distinguished from new non-expiring wallet deposits', () => {
  const {portalView}=loadViews();
  const h=browserHarness(),s=h.controller.state;
  s.user={id:1,username:'test'};
  s.checkout={id:'old',billing_type:'subscription',package:'1 Hari',amount:30000,
    total_amount:30021,status:'pending'};
  const html=portalView(s);
  assert.ok(html.includes('Tagihan langganan lama, bukan top up saldo API'));
  assert.ok(html.includes('tidak menambah saldo API'));
  assert.ok(!html.includes('Saldo yang ditambahkan:'));
  assert.ok(!html.includes('1 Hari'));
});

test('closed legacy daily invoices stay in history without duration labels or an active checkout', () => {
  const { portalView, paymentButtonState } = loadViews();
  const s = browserHarness().controller.state;
  s.user = { id: 1, username: 'test' };
  s.wallet = { balance: 0, reserved: 0, minimumTopup: 100000, maximumTopup: 100000000 };
  s.paymentConfig = { available: true };
  for (const status of ['expired', 'paid', 'failed']) {
    s.checkout = { id: 'old', billing_type: 'subscription', package: '1 Hari', amount: 30000,
      total_amount: 30374, status, created_at: '2026-10-14T00:00:00Z' };
    s.payments = [s.checkout, { package: '7 Hari', amount: 60000, status: 'approved' }];
    const html = portalView(s);
    assert.ok(!/1 Hari|7 Hari/.test(html));
    assert.ok(!html.includes('aria-label="Tagihan KlikQRIS"'));
    assert.ok(!html.includes('data-action="payment-check"'));
    assert.ok(html.includes('Pembayaran lama'));
    assert.ok(html.includes('30.374'));
    assert.equal(paymentButtonState(s).disabled, false);
    assert.equal(s.checkout.package, '1 Hari'); // Presentation only, no data rewrite.
    assert.equal(s.payments.length, 2);
  }
});

test('revoked state has no create button and docs describe the Wan API contract', () => {
  const { portalView, curlExample } = loadViews();
  const h = browserHarness();
  const s = h.controller.state;
  s.user = { username: 'dev' };
  s.overview = { keys: [{ status: 'revoked', api_key: 'hidden' }], hasLifetimeKey: true, totalRequests: 3, providers: [], generationProvider: 'Freepik' };
  const html = portalView(s);
  assert.ok(html.includes('Wan 3.0 Uncensored'));
  assert.match(html,/Video · Uncensored|VIDEO · UNCENSORED/);
  assert.ok(html.includes('href="#model"'));
  assert.ok(!/generator|Ke generator|Buka generator/i.test(html));
  assert.ok(html.includes('Belum terkonfirmasi'));
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

test('generation history UI shows safe statuses, uncertain notices and only protected Xclip downloads', () => {
  const { generationHistoryContent } = loadViews();
  const html = generationHistoryContent({ generationTasks: [
    { taskId: 'done', status: 'completed', videoUrl: '/api/videogen/proxy-video?taskId=done' },
    { taskId: 'failed', status: 'failed', error: '<script>bad</script>' },
    { taskId: 'waiting', status: 'pending', notice: 'Jangan kirim ulang' },
    { taskId: 'running', status: 'processing' },
    { taskId: 'external', status: 'completed', videoUrl: 'https://media.flora.ai/private' },
    { taskId: 'unsafe', status: 'completed', videoUrl: 'javascript:alert(1)' },
  ] });
  for (const label of ['Selesai', 'Gagal', 'Menunggu', 'Sedang diproses', 'Jangan kirim ulang']) assert.ok(html.includes(label));
  assert.equal((html.match(/Unduh video/g) || []).length, 1);
  assert.ok(!/flora|javascript:|<script>/.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(generationHistoryContent({ generationTasks: [] }).includes('Belum ada tugas'));
  assert.ok(generationHistoryContent({ generationError: 'Coba lagi' }).includes('role="alert"'));
});

test('new model docs and examples use Rp6.500/30s separately without public provider identity', () => {
  const {portalView,curlExample}=loadViews();
  const s=browserHarness().controller.state;
  s.user={username:'dev'};
  s.docModelId='wan-3.0';
  s.models=[{id:'wan-3.0',status:'available',pricePerVideo:6500},
    {id:'wan-3.0-uncensored',status:'unavailable',pricePerVideo:6000}];
  const html=portalView(s);
  assert.ok(html.includes('6.500'));
  assert.ok(html.includes('6.000'));
  assert.ok(html.includes('Durasi hanya 30 detik'));
  assert.ok(html.includes('akun dengan langganan lama'));
  assert.ok(html.includes('Belum tersedia'));
  assert.ok(html.includes('Tersedia'));
  assert.ok(!/flora|picsart|wan3.0-video|gw-v2/i.test(html));
  for(const id of ['wan-3.0','wan-3.0-uncensored']) {
    const body=JSON.parse(curlExample('generate',id).match(/-d '([\s\S]*)'/)[1]);
    assert.equal(body.model,id);
    assert.equal(body.duration,30);
    require('../server/wan-provider').validateInput(body);
  }
});

test('Seedance docs, catalog and cURL use public model and Rp11.000 without changing Wan prices', () => {
  const {portalView,curlExample}=loadViews();
  const s=browserHarness().controller.state;
  s.user={username:'dev'};
  s.docModelId='seedance-2.5';
  s.models=[{id:'seedance-2.5',status:'available',pricePerVideo:11000}];
  const html=portalView(s);
  assert.ok(html.includes('Seedance 2.5'));
  assert.ok(html.includes('11.000'));
  assert.ok(html.includes('6.500'));
  assert.ok(html.includes('6.000'));
  assert.ok(html.includes('Durasi hanya 30 detik'));
  assert.ok(!/picsart|flora|seedance_2_5|generate_audio|gw-v2/i.test(html));
  const body=JSON.parse(curlExample('generate','seedance-2.5').match(/-d '([\s\S]*)'/)[1]);
  assert.equal(body.model,'seedance-2.5');
  assert.equal(body.duration,30);
  assert.equal(body.resolution,'480p');
  require('../server/wan-provider').validateInput(body);
});

test('Seedance 2.0 docs and cURL use 15 seconds and Rp5000, never 2.5 contract fields', () => {
  const {portalView,curlExample}=loadViews();
  const s=browserHarness().controller.state;
  s.user={username:'dev'};
  s.docModelId='seedance-2.0';
  s.models=[{id:'seedance-2.0',status:'available',pricePerVideo:5000}];
  const html=portalView(s);
  assert.ok(html.includes('Seedance 2.0'));
  assert.ok(html.includes('5.000'));
  assert.ok(html.includes('Durasi hanya 15 detik'));
  assert.ok(!/picsart|flora|seedance_2_0|generate_audio|gw-v2/i.test(html));
  const body=JSON.parse(curlExample('generate','seedance-2.0').match(/-d '([\s\S]*)'/)[1]);
  assert.equal(body.model,'seedance-2.0');
  assert.equal(body.duration,15);
  assert.equal(body.resolution,'480p');
  require('../server/wan-provider').validateInput(body);
  for(const id of ['wan-3.0','wan-3.0-uncensored','seedance-2.5']) {
    assert.ok(curlExample('generate',id).includes('"duration": 30'));
  }
});

test('generation polling updates all loaded pages without duplicate tasks and ignores a stale account response', async () => {
  const pages = [];
  let resolveResponse;
  const h = browserHarness({ fetch: async path => {
    pages.push(path);
    const page = Number(new URL(path, 'https://xclip.test').searchParams.get('page'));
    return { ok: true, json: async () => ({ tasks: [{ taskId: `task-${page}`, status: 'completed' }], page, hasMore: page === 1 }) };
  } });
  h.controller.state.user = { id: 1 };
  h.controller.state.generationPage = 2;
  h.controller.state.generationTasks = [{ taskId: 'task-2', status: 'processing' }];
  await h.controller.loadGenerationHistory({ poll: true });
  assert.equal(pages.length, 2);
  assert.equal(h.controller.state.generationTasks.length, 2);
  assert.equal(h.controller.state.generationTasks[1].status, 'completed');
  assert.equal(h.controller.state.generationHasMore, false);
  const stale = browserHarness({ fetch: () => new Promise(resolve => { resolveResponse = resolve; }) });
  stale.controller.state.user = { id: 1 };
  const work = stale.controller.loadGenerationHistory();
  stale.controller.state.user = { id: 2 };
  resolveResponse({ ok: true, json: async () => ({ tasks: [{ taskId: 'private-old-user' }], page: 1, hasMore: false }) });
  await work;
  assert.equal(stale.controller.state.generationTasks.length, 0);
});

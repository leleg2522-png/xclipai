const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createKlikQrisProvider, PaymentError, sameSignature } = require('../server/klikqris-provider');
const { createPaymentService, publicInvoice } = require('../server/klikqris-service');
const paymentRoutes = require('../server/klikqris-routes');

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const env = { KLIKQRIS_API_KEY: 'fake-api-secret', KLIKQRIS_MERCHANT_ID: 'fake-merchant', KLIKQRIS_MODE: 'pg' };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const gatewayData = (changes = {}) => ({
  order_id: 'XCWEB-test', amount: '30000.00', total_amount: '30021.00', status: 'PENDING',
  signature: 'fake-original-signature', expired_at: '2030-01-01 10:00:00',
  qris_image: 'data:image/png;base64,' + png.toString('base64'), ...changes,
});

test('merchant mode must be explicit; credentials alone never select a payment destination', () => {
  const { KLIKQRIS_MODE, ...credentials } = env;
  assert.throws(() => createKlikQrisProvider({ env: credentials }).configuration(),
    error => error.status === 503 && /Mode pembayaran/.test(error.message));
});

test('KlikQRIS sends server-only credentials, immutable amount and callback to the documented API', async () => {
  const calls = [];
  const provider = createKlikQrisProvider({
    env: { ...env, KLIKQRIS_CALLBACK_URL: 'https://example.test/api/payments/klikqris/webhook' },
    fetcher: async (url, options) => { calls.push({ url, options }); return json({ status: true, data: gatewayData() }); },
  });
  const created = await provider.create('XCWEB-test', 30000, 'Xclip — 1 Hari');
  assert.equal(created.total, 30021);
  assert.equal(created.expiresAt, '2030-01-01T03:00:00.000Z');
  assert.equal(calls[0].url, 'https://klikqris.com/api/qris/create');
  assert.equal(calls[0].options.headers['x-api-key'], env.KLIKQRIS_API_KEY);
  assert.equal(calls[0].options.redirect, 'error');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.amount, 30000);
  assert.equal(body.callback_url, 'https://example.test/api/payments/klikqris/webhook');
  for (const mode of ['my_pg', 'sandbox']) {
    const paths = [];
    const p = createKlikQrisProvider({ env: { ...env, KLIKQRIS_MODE: mode }, fetcher: async url => {
      paths.push(url); return json({ status: true, data: gatewayData() });
    } });
    await p.create('XCWEB-test', 30000, 'Test');
    await p.status({ order_id: 'XCWEB-test', mode, merchant_id: env.KLIKQRIS_MERCHANT_ID,
      amount: 30000, total_amount: 30021, signature: 'fake-original-signature' });
    assert.ok(paths[0].includes(mode === 'my_pg' ? '/qrisv2/create' : '/sandbox/qris/create'));
    assert.ok(paths[1].includes(mode === 'my_pg' ? '/qrisv2/status/fake-merchant/XCWEB-test' : '/sandbox/qris/status/XCWEB-test'));
  }
});

test('paid status is rejected unless authenticated order, total, base amount and signature match', async () => {
  const invoice = { order_id: 'XCWEB-test', amount: 30000, total_amount: 30021,
    signature: 'fake-original-signature', mode: 'pg', merchant_id: env.KLIKQRIS_MERCHANT_ID };
  for (const changes of [{ order_id: 'other-order' }, { total_amount: 29999 }, { amount: 1 },
    { signature: 'wrong-signature' }, { merchant_id: 'other-merchant' }, { status: 'unknown' }]) {
    const p = createKlikQrisProvider({ env, fetcher: async () => json({ status: true,
      data: gatewayData({ status: 'SUCCESS', ...changes }) }) });
    await assert.rejects(p.status(invoice), PaymentError);
  }
  const p = createKlikQrisProvider({ env, fetcher: async () => json({ status: true,
    data: gatewayData({ status: 'SUCCESS' }) }) });
  assert.equal((await p.status(invoice)).status, 'paid');
  assert.equal(sameSignature('correct', 'correct'), true);
  assert.equal(sameSignature('correct', 'x'.repeat(10000)), false);
});

test('gateway errors and uncertain creates are sanitized and never retried', async () => {
  let attempts = 0;
  const p = createKlikQrisProvider({ env, fetcher: async () => {
    attempts++; throw new Error('fake-api-secret private raw body');
  } });
  await assert.rejects(p.create('XCWEB-test', 30000, 'Test'),
    error => !error.definite && !/fake-api-secret|private/.test(error.message));
  assert.equal(attempts, 1);
  const denied = createKlikQrisProvider({ env, fetcher: async () => json({
    status: false, message: 'private merchant credentials',
  }, 401) });
  await assert.rejects(denied.create('XCWEB-test', 30000, 'Test'),
    error => error.definite && !/credentials|private/.test(error.message));
  const invalidQr = createKlikQrisProvider({ env, fetcher: async () => json({
    status: true, data: gatewayData({ qris_image: null, qris_url: 'http://127.0.0.1/admin' }),
  }) });
  await assert.rejects(invalidQr.create('XCWEB-test', 30000, 'Test'), PaymentError);
});

test('QR images are bounded trusted PNGs fetched without merchant headers or redirects', async () => {
  const calls = [];
  const p = createKlikQrisProvider({ env, fetcher: async (url, options) => {
    calls.push({ url, options });
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  } });
  assert.deepEqual(await p.image({ qr_url: 'https://klikqris.com/storage/qr.png' }), png);
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(p.image({ qr_url: 'https://evil.test/storage/qr.png' }), PaymentError);
  assert.equal(calls.length, 1);
  const html = createKlikQrisProvider({ env, fetcher: async () =>
    new Response('<html>gateway error</html>', { headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(html.image({ qr_url: 'https://klikqris.com/storage/qr.png' }), PaymentError);
});

// Isolated fake PostgreSQL implementation: no Railway queries or real invoices.
function fixture({ mode = 'pg', createError } = {}) {
  const locks = new Map();
  async function acquire(key) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    locks.set(key, next);
    await previous;
    return () => { release(); if (locks.get(key) === next) locks.delete(key); };
  }
  const state = {
    invoices: new Map(), users: new Map([[1, { subscription_expired_at: new Date(Date.now() + 5 * 86400000) }], [2, {}]]),
    subscriptions: [], legacy: [{ id: 7, user_id: 1, package: 'Paket lama', amount: 5000,
      status: 'approved', created_at: new Date('2020-01-01') }],
    createCalls: 0, statusCalls: 0, renewals: 0, gatewayStatus: 'pending', failRenewal: false,
  };
  const copy = row => row ? { ...row } : undefined;
  const provider = {
    configuration: () => ({ mode, merchantId: 'fake-merchant', callbackConfigured: false }),
    async create() {
      state.createCalls++;
      if (createError) throw createError;
      return { total: 30021, signature: 'fake-original-signature', qrImage: png, qrUrl: null,
        expiresAt: '2030-01-01T03:00:00Z' };
    },
    async status() { state.statusCalls++; return { status: state.gatewayStatus }; },
    async image() { return png; },
  };
  async function query(sql, args = [], client = {}) {
    const text = sql.replace(/\s+/g, ' ').trim();
    const rows = value => ({ rows: value });
    if (text.startsWith('CREATE ')) return rows([]);
    if (text.includes('pg_advisory_lock(')) { client.unlock = await acquire('create-' + args[1]); return rows([]); }
    if (text.includes('pg_advisory_unlock(')) { client.unlock?.(); client.unlock = null; return rows([]); }
    if (text === 'BEGIN') {
      client.commit = await acquire('transaction');
      client.before = { invoices: new Map([...state.invoices].map(([k, v]) => [k, copy(v)])),
        users: new Map([...state.users].map(([k, v]) => [k, copy(v)])),
        subscriptions: state.subscriptions.map(copy) };
      return rows([]);
    }
    if (text === 'COMMIT' || text === 'ROLLBACK') {
      if (text === 'ROLLBACK') Object.assign(state, client.before);
      client.commit?.(); client.commit = null;
      return rows([]);
    }
    if (text.startsWith('SELECT id FROM portal_qris_invoices WHERE order_id')) {
      return rows([...state.invoices.values()].filter(r => r.order_id === args[0]).map(r => ({ id: r.id })));
    }
    if (text.startsWith('SELECT id FROM portal_qris_invoices WHERE user_id')) {
      return rows([...state.invoices.values()].filter(r => r.user_id === args[0] && args[1].includes(r.status)).map(copy));
    }
    if (text.startsWith('SELECT * FROM portal_qris_invoices')) {
      let values = [...state.invoices.values()];
      if (text.includes('WHERE id = $1')) values = values.filter(r => r.id === args[0] && (args.length < 2 || r.user_id === args[1]));
      else if (text.includes('user_id = $1')) values = values.filter(r => r.user_id === args[0] &&
        (!text.includes('idempotency_key') || r.idempotency_key === args[1]));
      else values = values.filter(r => r.status === 'pending');
      values.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return rows((text.includes('LIMIT 1') && !text.includes('LIMIT 100') ? values.slice(0, 1) : values).map(copy));
    }
    if (text.startsWith('SELECT id, name, price_idr')) {
      return rows(args[0] === 1 ? [{ id: 1, name: '3 Hari', price_idr: 30000, duration_days: 3 }] : []);
    }
    if (text.startsWith('INSERT INTO portal_qris_invoices')) {
      const row = { id: args[0], order_id: args[1], user_id: args[2], idempotency_key: args[3],
        plan_id: args[4], package: args[5], duration_days: args[6], amount: args[7], mode: args[8],
        merchant_id: args[9], status: 'creating', created_at: new Date(), total_amount: null, signature: null };
      state.invoices.set(row.id, row);
      return rows([copy(row)]);
    }
    if (text.startsWith('UPDATE portal_qris_invoices')) {
      const row = state.invoices.get(args[0]);
      if (text.includes("status <> 'paid'") && row.status === 'paid') return rows([]);
      if (text.includes("status = 'pending'")) Object.assign(row, { status: 'pending', total_amount: args[1],
        signature: args[2], qr_image: args[3], qr_url: args[4], expires_at: args[5] });
      else if (text.includes("status = 'paid'")) Object.assign(row, { status: 'paid', paid_at: new Date(), qr_image: null, qr_url: null });
      else if (text.includes('status = $2')) {
        row.status = args[1];
        if (row.status === 'expired') { row.qr_image = row.qr_url = null; }
      }
      if (text.includes('last_checked_at = NOW()')) row.last_checked_at = new Date();
      return rows([copy(row)]);
    }
    if (text.startsWith('SELECT subscription_expired_at')) return rows([copy(state.users.get(args[0]))].filter(Boolean));
    if (text.startsWith('SELECT id, expired_at FROM subscriptions')) {
      return rows(state.subscriptions.filter(r => r.user_id === args[0]).map(copy));
    }
    if (text.startsWith('UPDATE users SET subscription_expired_at')) {
      state.users.get(args[1]).subscription_expired_at = args[0];
      state.renewals++;
      return rows([]);
    }
    if (text.startsWith('UPDATE subscriptions')) {
      if (state.failRenewal) throw new Error('simulated commit failure');
      for (const row of state.subscriptions.filter(r => r.user_id === args[2])) {
        Object.assign(row, { expired_at: args[0], plan_id: args[1], status: 'active' });
      }
      return rows([]);
    }
    if (text.startsWith('INSERT INTO subscriptions')) {
      if (state.failRenewal) throw new Error('simulated insert failure');
      state.subscriptions.push({ id: 1, user_id: args[0], expired_at: args[1], plan_id: args[2], status: 'active' });
      return rows([]);
    }
    if (text.startsWith('SELECT id, package, amount, status, created_at FROM payments')) {
      return rows(state.legacy.filter(r => r.user_id === args[0]).map(({ id, package: pkg, amount, status, created_at }) =>
        ({ id, package: pkg, amount, status, created_at })));
    }
    throw new Error('Unexpected test SQL: ' + text);
  }
  const pool = {
    query: (sql, args) => query(sql, args),
    async connect() {
      const client = { release() {}, query: (sql, args) => query(sql, args, client) };
      return client;
    },
  };
  return { pool, provider, state, service: createPaymentService(pool, provider) };
}

test('concurrent creates and replay create one invoice; plan prices are loaded from DB, not the client', async () => {
  const h = fixture();
  await h.service.initialize();
  const [a, b] = await Promise.all([h.service.create(1, 1, 'same-key'), h.service.create(1, 1, 'same-key')]);
  assert.equal(a.id, b.id);
  assert.equal(a.amount, 30000);
  assert.equal(h.state.createCalls, 1);
  await assert.rejects(h.service.create(1, 2, 'same-key'), error => error.status === 409);
  await assert.rejects(h.service.create(1, 1, 'different-key'), error => error.status === 409);
  const data = JSON.stringify(publicInvoice(a));
  assert.ok(!/signature|merchant|idempotency|original|fake-api/.test(data));
});

test('uncertain create is persisted, blocks new creates, and never gets submitted again', async () => {
  const h = fixture({ createError: new PaymentError(502, 'Unknown delivery') });
  await h.service.initialize();
  await assert.rejects(h.service.create(1, 1, 'one'), PaymentError);
  assert.equal((await h.service.current(1)).status, 'uncertain');
  assert.equal((await h.service.create(1, 1, 'one')).status, 'uncertain');
  await assert.rejects(h.service.create(1, 1, 'two'), error => error.status === 409);
  assert.equal(h.state.createCalls, 1);
  assert.equal(h.state.renewals, 0);
});

test('verified paid callbacks across service instances extend legacy subscription exactly once', async () => {
  const h = fixture();
  await h.service.initialize();
  const row = await h.service.create(1, 1, 'one');
  const base = h.state.users.get(1).subscription_expired_at.getTime() + 86400000;
  h.state.subscriptions.push({ id: 4, user_id: 1, room_id: 7, expired_at: new Date(base), status: 'active' });
  h.state.gatewayStatus = 'paid';
  const other = createPaymentService(h.pool, h.provider);
  await other.initialize();
  await Promise.all([h.service.synchronize(row), other.synchronize(row)]);
  assert.equal(h.state.renewals, 1);
  assert.equal(h.state.users.get(1).subscription_expired_at.getTime(), base + 3 * 86400000);
  assert.equal(h.state.subscriptions[0].room_id, 7);
  assert.equal(h.state.invoices.get(row.id).status, 'paid');
  const replay = await h.service.create(1, 1, 'one');
  assert.equal(replay.status, 'paid');
  assert.equal(h.state.createCalls, 1);
  const history = await h.service.history(1);
  assert.equal(history.length, 2);
  assert.ok(!JSON.stringify(history).includes('fake-original-signature'));
});

test('subscription and invoice roll back together if activation fails', async () => {
  const h = fixture();
  await h.service.initialize();
  const row = await h.service.create(1, 1, 'one');
  const before = h.state.users.get(1).subscription_expired_at.getTime();
  h.state.failRenewal = true;
  h.state.gatewayStatus = 'paid';
  await assert.rejects(h.service.synchronize(row));
  assert.equal(h.state.invoices.get(row.id).status, 'pending');
  assert.equal(h.state.users.get(1).subscription_expired_at.getTime(), before);
});

test('expired invoices can be replaced; sandbox paid never credits a real subscription', async () => {
  const h = fixture({ mode: 'sandbox' });
  await h.service.initialize();
  const a = await h.service.create(1, 1, 'one');
  h.state.gatewayStatus = 'expired';
  assert.equal((await h.service.synchronize(a)).status, 'expired');
  assert.equal(publicInvoice(await h.service.find(a.id)).qr_url, null);
  const b = await h.service.create(1, 1, 'two');
  h.state.gatewayStatus = 'paid';
  assert.equal((await h.service.synchronize(b)).status, 'paid');
  assert.equal(h.state.renewals, 0);
});

test('routes enforce ownership, reject forged callbacks, and independently verify a signed PAID claim', async t => {
  const h = fixture();
  await h.service.initialize();
  const row = await h.service.create(1, 1, 'one');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: Number(req.headers['x-test-user']) || null }; next(); });
  app.use(paymentRoutes(h));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/payments/klikqris/config')).status, 401);
  assert.equal((await fetch(base + '/api/payments/klikqris/' + row.id, { headers: { 'x-test-user': '2' } })).status, 404);
  assert.equal((await fetch(base + '/api/payments/klikqris/' + row.id + '/qr', { headers: { 'x-test-user': '2' } })).status, 404);
  const callback = async signature => fetch(base + '/api/payments/klikqris/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { order_id: row.order_id, signature, status: 'PAID' } }),
  });
  assert.equal((await callback('forged')).status, 403);
  assert.equal(h.state.statusCalls, 0);
  assert.equal((await callback(row.signature)).status, 200);
  assert.equal(h.state.renewals, 0); // actual gateway still PENDING
  h.state.gatewayStatus = 'paid';
  assert.equal((await callback(row.signature)).status, 200);
  assert.equal((await callback(row.signature)).status, 200);
  assert.equal(h.state.renewals, 1);
  const history = await (await fetch(base + '/api/payments/my', { headers: { 'x-test-user': '1' } })).json();
  assert.ok(!JSON.stringify(history).includes('fake-original-signature'));
  assert.equal((await fetch(base + '/api/payments/submit', {
    method: 'POST', headers: { 'x-test-user': '1' },
  })).status, 410);
});

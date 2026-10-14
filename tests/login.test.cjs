const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const loginHandler = require('../server/login');

function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; } };
}
function session() {
  return { regenerated: false, saved: false,
    regenerate(cb) { this.regenerated = true; cb(); },
    save(cb) { this.saved = true; cb(); } };
}

test('existing Railway-style user logs in with original bcrypt password and unchanged user ID', async () => {
  const hash = await bcrypt.hash('original-password', 4);
  const queries = [];
  const pool = { async query(sql, values) {
    queries.push({ sql, values });
    return { rows: [{ id: 72, username: 'existing_dev', email: 'Old@Example.test',
      password_hash: hash, has_api_key: true }] };
  } };
  const req = { body: { email: '  OLD@EXAMPLE.TEST  ', password: 'original-password' }, session: session() };
  const res = response();
  await loginHandler(pool)(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(req.session.userId, 72);
  assert.equal(req.session.regenerated, true);
  assert.equal(req.session.saved, true);
  assert.deepEqual(queries[0].values, ['old@example.test']);
  assert.ok(queries[0].sql.includes('LOWER(BTRIM(email))'));
  assert.equal(queries.length, 1);
  assert.ok(queries.every(q => !/INSERT|UPDATE|DELETE/.test(q.sql)));
  assert.equal(res.body.user.id, 72);
  assert.equal(res.body.user.hasApiKey, true);
  assert.ok(!/password|hash|freepik|provider/.test(JSON.stringify(res.body)));
});

test('wrong password, missing account and ambiguous legacy email never establish a session', async () => {
  const hash = await bcrypt.hash('right', 4);
  for (const rows of [[], [{ id: 1, password_hash: hash }], [{ id: 1, password_hash: hash }, { id: 2, password_hash: hash }]]) {
    const req = { body: { email: 'user@example.test', password: 'wrong' }, session: session() };
    const res = response();
    await loginHandler({ async query() { return { rows }; } })(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(req.session.userId, undefined);
    assert.equal(req.session.regenerated, false);
  }
});

test('legacy short password remains usable without relaxing new-account registration rules', async () => {
  const hash = await bcrypt.hash('old', 4);
  const req = { body: { email: 'user@example.test', password: 'old' }, session: session() };
  const res = response();
  await loginHandler({ async query() { return { rows: [{ id: 1, password_hash: hash }] }; } })(req, res);
  assert.equal(res.statusCode, 200);
});

test('invalid login inputs do not query the database', async () => {
  for (const body of [{}, { email: ['x'], password: 'p' }, { email: 'u@e.test', password: {} },
    { email: 'u@e.test', password: '' }, { email: 'u@e.test', password: 'p'.repeat(129) }]) {
    const res = response();
    await loginHandler({ async query() { throw new Error('must not query'); } })({ body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('session persistence failure never reports a successful login', async () => {
  const req = { body: { email: 'user@example.test', password: 'test' },
    session: { regenerate(cb) { cb(); }, save(cb) { cb(new Error('test session failure')); } } };
  const res = response();
  await loginHandler({ async query() { return { rows: [{ id: 1, password_hash: 'fake-test-hash' }] }; } }, async () => true)(req, res);
  assert.equal(res.statusCode, 503);
  assert.ok(!res.body.success);
  assert.equal(req.session.userId, undefined);
});

test('passwordless legacy accounts are not given passwords or authenticated without identity verification', async () => {
  let compared = false;
  const req = { body: { email: 'user@example.test', password: 'any-password' }, session: session() };
  const res = response();
  await loginHandler({ async query() { return { rows: [{ id: 1, password_hash: null }] }; } },
    async () => { compared = true; return true; })(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(compared, false);
  assert.equal(req.session.userId, undefined);
});

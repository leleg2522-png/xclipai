const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const allowed = require('../server/cors-origin');
const corsPolicy = require('../server/cors-policy');

test('Replit workspace parent is allowed only in development', () => {
  assert.equal(allowed('https://replit.com', { production: false }), true);
  assert.equal(allowed('https://replit.com', { production: true }), false);
  assert.equal(allowed('https://replit.com.evil.test', { production: false }), false);
});

test('opaque origins, arbitrary websites and malformed origin values remain blocked', () => {
  for (const origin of ['null', 'https://evil.test', 'https://replit.com:444',
    'https://user:password@replit.com', 'https://replit.com/path', 'file://localhost', 'not-a-url']) {
    assert.equal(allowed(origin), false, origin);
  }
});

test('existing preview and Railway origins and explicitly configured origins still work', () => {
  for (const origin of ['https://app.replit.dev', 'https://app.up.railway.app', 'http://localhost:5000']) {
    assert.equal(allowed(origin, { production: true }), true);
  }
  const options = { production: true, allowedOrigins: ['https://api.example.test', 'custom.example.test'] };
  assert.equal(allowed('https://api.example.test', options), true);
  assert.equal(allowed('http://api.example.test', options), false);
  assert.equal(allowed('https://app.custom.example.test', options), true);
});

test('workspace login preflight and failed credentials return readable credentialed CORS responses', async t => {
  const app = express();
  app.use(cors({ credentials: true, origin: (origin, done) => done(null,
    !origin || allowed(origin, { production: false })) }));
  app.post('/api/auth/login', (_req, res) => res.status(401).json({ error: 'Email atau password salah' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
  const preflight = await fetch(url, { method: 'OPTIONS', headers: {
    Origin: 'https://replit.com', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://replit.com');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const login = await fetch(url, { method: 'POST', headers: { Origin: 'https://replit.com' } });
  assert.equal(login.status, 401);
  assert.equal(login.headers.get('access-control-allow-origin'), 'https://replit.com');
  assert.equal((await login.json()).error, 'Email atau password salah');
});

test('production CORS policy rejects an arbitrary origin with a safe 403 reference, not a 500', async t => {
  const records = [];
  const app = express();
  app.use(corsPolicy(origin => allowed(origin, { production: true }), record => records.push(record)));
  let invoked = 0;
  app.post('/api/videogen/proxy', (_req, res) => { invoked++; res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/videogen/proxy`;
  for (const method of ['OPTIONS', 'POST']) {
    const res = await fetch(url, { method, headers: { Origin: 'https://untrusted.example', 'X-Xclip-Key': 'test_secret' } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const data = await res.json();
    assert.equal(data.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(data.requestId, res.headers.get('x-xclip-request-id'));
    assert.match(data.requestId, /^[a-f0-9-]{36}$/);
    assert.ok(data.error.includes('backend/server'));
    assert.ok(!JSON.stringify({ data, records }).includes('test_secret'));
  }
  assert.equal(invoked, 0);
  const preflight = await fetch(url, { method: 'OPTIONS', headers: {
    Origin: 'https://my.up.railway.app', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,x-xclip-key,idempotency-key',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://my.up.railway.app');
  assert.ok(preflight.headers.get('access-control-allow-headers').includes('idempotency-key'));
  const noOrigin = await fetch(url, { method: 'POST' });
  assert.equal(noOrigin.status, 200);
  const permitted = await fetch(url, { method: 'POST', headers: { Origin: 'https://my.up.railway.app' } });
  assert.equal(permitted.status, 200);
  assert.ok(permitted.headers.get('access-control-expose-headers').includes('X-Xclip-Request-Id'));
});

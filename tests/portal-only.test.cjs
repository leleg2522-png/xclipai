const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const pageRoutes = require('../server/pages');
const developerRouter = require('../server/developer');

test('homepage and developer alias show the portal; all legacy UI entry points are retired', async () => {
  const app = express();
  app.use(pageRoutes());
  app.use(express.static(path.resolve('client')));
  app.use(developerRouter({ query() { throw new Error('page navigation must not query DB'); } }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/?preview=1', '/developer']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const html = await res.text();
      assert.ok(html.includes('Xclip — Portal Developer'));
      assert.ok(html.includes('id="developer-app"'));
      assert.ok(!html.includes('/src/main.js'));
    }
    for (const route of ['/generator', '/generator/', '/admin', '/index.html',
      '/src/main.js?v=39', '/styles/main.css?v=38', '/manifest.json']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 410, route);
      assert.ok(!res.headers.get('content-type').includes('text/html'));
    }
    for (const asset of ['/src/developer.js?v=2', '/styles/developer.css?v=2']) {
      const res = await fetch(base + asset);
      assert.equal(res.status, 200);
      assert.ok(!res.headers.get('content-type').includes('text/html'));
    }
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { status: 'ok' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('legacy files are removed and the production fallback cannot restore the old app', () => {
  for (const file of ['client/index.html', 'client/src/main.js', 'client/styles/main.css', 'client/manifest.json']) {
    assert.equal(fs.existsSync(file), false, file);
  }
  const source = fs.readFileSync('server.js', 'utf8');
  assert.ok(source.indexOf("app.use(require('./server/pages')())") <
    source.indexOf("app.use(express.static(path.join(__dirname, 'client')"));
  assert.ok(!source.includes("res.sendFile(path.join(__dirname, 'client', 'index.html'))"));
});

test('retirement service worker clears only legacy caches and unregisters without intercepting requests', async () => {
  const handlers = {};
  const deleted = [];
  let claimed = false, unregistered = false;
  vm.runInNewContext(fs.readFileSync('client/sw.js', 'utf8'), {
    self: {
      addEventListener(name, handler) { handlers[name] = handler; },
      clients: { async claim() { claimed = true; } },
      registration: { async unregister() { unregistered = true; } },
    },
    caches: {
      async keys() { return ['xclip-v4', 'xclip-v5', 'unrelated-app']; },
      async delete(key) { deleted.push(key); return true; },
    },
  });
  let operation;
  handlers.activate({ waitUntil(value) { operation = value; } });
  await operation;
  assert.deepEqual(deleted, ['xclip-v4', 'xclip-v5']);
  assert.equal(claimed, true);
  assert.equal(unregistered, true);
  assert.equal(handlers.fetch, undefined);
});

test('portal startup unregisters old workers but leaves unrelated registrations and caches intact', async () => {
  const source = fs.readFileSync('client/src/developer.js', 'utf8');
  const start = source.indexOf('async function retireLegacyFrontend()');
  const end = source.indexOf('async function start()', start);
  let retired = false, unrelated = false;
  const deleted = [];
  const cleanup = vm.runInNewContext(source.slice(start, end) + '\nretireLegacyFrontend;', {
    URL, console,
    navigator: { serviceWorker: { async getRegistrations() { return [
      { active: { scriptURL: 'https://xclip.example/sw.js' }, async unregister() { retired = true; } },
      { active: { scriptURL: 'https://xclip.example/other.js' }, async unregister() { unrelated = true; } },
    ]; } } },
    caches: {
      async keys() { return ['xclip-v4', 'other-cache']; },
      async delete(key) { deleted.push(key); },
    },
  });
  await cleanup();
  assert.equal(retired, true);
  assert.equal(unrelated, false);
  assert.deepEqual(deleted, ['xclip-v4']);
});

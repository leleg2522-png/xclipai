const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const pageRoutes = require('../server/pages');
const developerRouter = require('../server/developer');

test('root is the portal; both generator paths and the developer alias still work', async () => {
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
    for (const route of ['/generator', '/generator/']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Xclip - AI Video Clipper &amp; Chat') ||
        html.includes('Xclip - AI Video Clipper & Chat'));
      assert.ok(html.includes('src="/src/main.js?v=39"'));
      assert.ok(html.includes('href="/styles/main.css?v=38"'));
      assert.ok(!html.includes('id="developer-app"'));
    }
    for (const asset of ['/src/main.js?v=39', '/styles/main.css?v=38']) {
      const res = await fetch(base + asset);
      assert.equal(res.status, 200);
      assert.ok(!res.headers.get('content-type').includes('text/html'));
    }
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { status: 'ok' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('production routing precedes static index serving', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.ok(source.indexOf("app.use(require('./server/pages')())") <
    source.indexOf("app.use(express.static(path.join(__dirname, 'client')"));
});

test('service worker does not replace the portal with an old generator page', async () => {
  const handlers = {};
  const lookedUp = [];
  const offlineGenerator = { offline: 'generator' };
  vm.runInNewContext(fs.readFileSync('client/sw.js', 'utf8'), {
    URL,
    self: { addEventListener(name, handler) { handlers[name] = handler; } },
    fetch: async () => { throw new Error('offline'); },
    caches: { async match(request) {
      lookedUp.push(request);
      return request === '/generator' ? offlineGenerator : undefined;
    } },
  });
  for (const pathname of ['/', '/developer', '/developer/', '/developer.html',
    '/src/developer.js?v=1', '/styles/developer.css?v=1', '/api/auth/me']) {
    let intercepted = false;
    handlers.fetch({
      request: { url: `https://xclip.example${pathname}`, method: 'GET' },
      respondWith() { intercepted = true; },
    });
    assert.equal(intercepted, false, pathname);
  }
  let result;
  handlers.fetch({
    request: { url: 'https://xclip.example/generator', method: 'GET' },
    respondWith(value) { result = value; },
  });
  assert.equal(await result, offlineGenerator);
  assert.equal(lookedUp.at(-1), '/generator');
});

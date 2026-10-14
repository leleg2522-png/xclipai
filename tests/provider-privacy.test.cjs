const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const { Readable } = require('node:stream');
const {
  publicVideoUrl, publicTask, streamVideo, checkedUrl, isPrivateAddress,
} = require('../server/public-video');

function response() {
  return {
    headers: {}, statusCode: 200, body: null, headersSent: false,
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    setHeader(name, value) { return this.set(name, value); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    destroy() {},
  };
}

// Load only the real route registration, not the server's startup/database side effects.
function route(marker, globals = {}) {
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.indexOf(marker);
  const end = source.indexOf('\n});', start) + 5;
  assert.ok(start >= 0 && end > start);
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    app: { get(_path, fn) { handler = fn; }, post(_path, fn) { handler = fn; } },
    console: { log() {}, error() {} },
    publicVideoUrl, publicTask, URL,
    process: { env: { TEST_UPSTREAM_KEY: 'fake_test_credential' } },
    videoRefreshCache: new Map(), videoRefreshFailed: new Map(),
    ...globals,
  });
  return handler;
}

test('create-task failures do not return upstream brand, URLs, or raw error data', async () => {
  const handler = route("app.post('/api/videogen/proxy'", {
    validateXclipApiKey: async () => ({ id: 1, user_id: 7 }),
    getUserCooldownRemaining: () => 0,
    saveBase64ToFile: async () => {
      throw Object.assign(new Error('Flora upstream failure'), {
        response: { status: 502, data: { detail: 'Picsart internal token fake_secret' } },
      });
    },
  });
  const res = response();
  await handler({ headers: { 'x-xclip-key': 'fake_xclip_key' }, body: { image: 'fake_image' } }, res);
  assert.equal(res.statusCode, 500);
  assert.ok(!/picsart|flora|upstream|fake_secret/i.test(JSON.stringify(res.body)));
});

test('status returns only the Xclip media path; provider HTML errors are generic', async () => {
  const globals = {
    validateXclipApiKey: async () => ({ id: 1, user_id: 7 }),
    pool: { async query() { return { rows: [{ task_id: 'task_1', used_key_name: 'TEST_UPSTREAM_KEY' }] }; } },
    releaseProxyForTask() {},
    makeFreepikRequest: async () => ({
      data: { data: { status: 'COMPLETED', generated: ['https://secret-cdn.example/video?token=fake'] } },
    }),
  };
  const req = {
    headers: { 'x-xclip-key': 'fake_xclip_key' }, params: { taskId: 'task_1' },
    query: { model: 'kling-v2.6-pro' }, session: {},
  };
  const res = response();
  await route("app.get('/api/videogen/tasks/:taskId'", globals)(req, res);
  assert.equal(res.body.videoUrl, publicVideoUrl('task_1'));
  assert.equal(res.body.status, 'completed');
  assert.ok(!/secret-cdn|fake|provider|key_name/.test(JSON.stringify(res.body)));
  const failed = response();
  await route("app.get('/api/videogen/tasks/:taskId'", {
    ...globals, makeFreepikRequest: async () => {
      throw { response: { data: '<!DOCTYPE html><p>Picsart Flora internal details</p>' } };
    },
  })(req, failed);
  assert.equal(failed.statusCode, 503);
  assert.ok(!/picsart|flora|freepik|internal/i.test(JSON.stringify(failed.body)));
});

test('task history projection strips credential, routing metadata, and upstream URLs', () => {
  const data = publicTask({
    id: 1, task_id: 'task_1', model: 'kling-v2.6-pro', status: 'completed',
    video_url: 'https://secret-cdn.example/video?token=fake',
    used_key_name: 'FLORA_KEY', api_key: 'unneeded_key', refresh_token: 'fake_secret',
  });
  assert.equal(data.video_url, publicVideoUrl('task_1'));
  assert.ok(!/secret-cdn|flora|api_key|refresh_token|fake_secret/i.test(JSON.stringify(data)));
});

test('video authentication is required and a revoked key cannot fall back to a session', async () => {
  const handler = route("app.get('/api/videogen/proxy-video'", {
    validateXclipApiKey: async () => null,
    pool: { async query() { throw new Error('must not query'); } },
  });
  for (const req of [
    { query: { taskId: 'task_1' }, headers: {}, session: {} },
    { query: { taskId: 'task_1' }, headers: { 'x-xclip-key': 'revoked' }, session: { userId: 7 } },
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  }
});

test('API-key video retrieval checks key ownership, not another logged-in user', async () => {
  const calls = [];
  const handler = route("app.get('/api/videogen/proxy-video'", {
    validateXclipApiKey: async () => ({ id: 41, user_id: 7 }),
    pool: { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } },
  });
  const res = response();
  await handler({ query: { taskId: 'another_task' }, headers: { 'x-xclip-key': 'fake' }, session: { userId: 99 } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok(call.sql.includes('xclip_api_key_id = $3'));
    assert.deepEqual(Array.from(call.params), ['another_task', 'completed', 41]);
  }
});

test('protected Xclip paths still work with the generator download endpoint', async () => {
  let streamed = false;
  const handler = route("app.get('/api/download-video'", {
    pool: { async query(_sql, params) {
      assert.deepEqual(Array.from(params), ['task_1', 7]);
      return { rows: [{ video_url: 'https://secret-cdn.example/video.mp4' }] };
    } },
    streamVideo: async (_req, res) => { streamed = true; res.status(200); },
  });
  const res = response();
  await handler({ query: { url: publicVideoUrl('task_1') }, session: { userId: 7 } }, res);
  assert.equal(streamed, true);
  assert.equal(res.statusCode, 200);
  assert.ok(!JSON.stringify(res.headers).includes('secret-cdn'));
});

test('private IPs, credential-bearing URLs and unsupported protocols are rejected', () => {
  for (const value of [
    'http://localhost/video', 'http://127.0.0.1/video', 'http://0x7f000001/video',
    'http://10.0.0.1/video', 'http://169.254.169.254/latest', 'http://[::1]/video',
    'http://[::ffff:127.0.0.1]/video', 'http://[fd00::1]/video',
    'https://user:password@example.test/video', 'file:///video', 'https://example.test:8080/video',
  ]) assert.throws(() => checkedUrl(value));
  assert.equal(checkedUrl('https://cdn.example.test/video?signature=fake').hostname, 'cdn.example.test');
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

async function mediaServer(request, work) {
  const app = express();
  app.get('/video', async (req, res) => {
    try { await streamVideo(req, res, 'https://private-provider.example/video?token=fake', request); }
    catch { if (!res.headersSent) res.status(502).json({ error: 'Video Xclip tidak tersedia' }); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('media is streamed through Xclip without redirect, upstream headers, or caller credentials', async () => {
  const calls = [];
  await mediaServer(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return {
      status: 302, headers: { location: 'https://cdn.example.test/video?token=fake' },
      data: Readable.from([]),
    };
    return {
      status: 206,
      headers: {
        'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 0-3/4',
        'accept-ranges': 'bytes', server: 'Flora', 'x-provider': 'Picsart',
        location: 'https://private-provider.example/video',
      },
      data: Readable.from([Buffer.from('test')]),
    };
  }, async base => {
    const res = await fetch(base + '/video', {
      headers: { Range: 'bytes=0-3', 'X-Xclip-Key': 'fake_private_xclip_key' },
    });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), 'test');
    assert.equal(res.headers.get('location'), null);
    assert.equal(res.headers.get('x-provider'), null);
    assert.equal(res.headers.get('server'), null);
    assert.equal(res.headers.get('content-range'), 'bytes 0-3/4');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.deepEqual(call.options.headers, { Range: 'bytes=0-3' });
      assert.equal(call.options.maxRedirects, 0);
    }
  });
});

test('redirects to private addresses and HTML responses do not reach the client', async () => {
  for (const upstream of [
    { status: 302, headers: { location: 'http://127.0.0.1/internal' }, data: Readable.from([]) },
    { status: 200, headers: { 'content-type': 'text/html' }, data: Readable.from(['Picsart private page']) },
  ]) {
    await mediaServer(async () => upstream, async base => {
      const res = await fetch(base + '/video');
      assert.equal(res.status, 502);
      assert.equal(res.headers.get('location'), null);
      assert.ok(!/picsart|flora|127\.0\.0\.1|private page/i.test(await res.text()));
    });
  }
});

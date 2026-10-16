const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAlrizMotionProvider, MotionError } = require('../server/alriz-motion-provider');
const motionRoutes = require('../server/alriz-motion-routes');
const { createGenerationLogger } = require('../server/generation-log');

const ok = body => ({ ok: true, status: 200, json: async () => body });
test('Alriz adapter submits only documented Pro fields with server-side key and no retries', async () => {
  const calls = [];
  const provider = createAlrizMotionProvider({ env: { ALRIZ_API_KEY: 'test-secret' },
    fetcher: async (url, options) => { calls.push({ url, options }); return ok({ job_id: 'ALRIZ_123' }); } });
  assert.equal(await provider.submit({ imageUrl: 'https://example.com/a.png', videoUrl: 'https://example.com/b.mp4', prompt: 'move' }), 'ALRIZ_123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://alrizmotion.my.id/api/jobs');
  assert.equal(calls[0].options.headers['X-API-Key'], 'test-secret');
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'mc-kling-2.6-pro', image_url: 'https://example.com/a.png',
    video_url: 'https://example.com/b.mp4', prompt: 'move',
  });
});
test('Alriz adapter maps documented states and fetches result only after DONE', async () => {
  let data = { status: 'QUEUED' }, resultCalls = 0;
  const p = createAlrizMotionProvider({ env: { ALRIZ_API_KEY: 'test' }, fetcher: async url => {
    if (url.endsWith('/result')) { resultCalls++; return ok({ result_url: 'https://example.com/out.mp4' }); }
    return ok(data);
  } });
  assert.deepEqual(await p.poll('ALRIZ_1'), { status: 'processing' });
  data = { status: 'PROCESSING' };
  assert.equal((await p.poll('ALRIZ_1')).status, 'processing');
  data = { status: 'NO_STOCK' };
  assert.equal((await p.poll('ALRIZ_1')).status, 'failed');
  data = { status: 'FAILED' };
  assert.equal((await p.poll('ALRIZ_1')).status, 'failed');
  data = { status: 'DONE' };
  assert.equal((await p.poll('ALRIZ_1')).videoUrl, 'https://example.com/out.mp4');
  assert.equal(resultCalls, 1);
  data = { status: 'new_unknown_state' };
  await assert.rejects(p.poll('ALRIZ_1'), MotionError);
});
test('Alriz rejects unsafe or expired media without revealing upstream payload', async () => {
  for (const data of [
    { status: 'DONE', result_url: 'http://127.0.0.1/secret' },
    { status: 'DONE', result_url: 'https://example.com/out.mp4', result_expired: true },
  ]) {
    const p = createAlrizMotionProvider({ env: { ALRIZ_API_KEY: 'test' }, fetcher: async () => ok(data) });
    await assert.rejects(p.poll('ALRIZ_1'), MotionError);
  }
});
test('Alriz authentication and transport failures are sanitized; uncertain submits never retry', async () => {
  let calls = 0;
  const p = createAlrizMotionProvider({ env: { ALRIZ_API_KEY: 'secret' },
    fetcher: async () => { calls++; return { ok: false, status: 401, json: async () => ({ error: 'Alriz secret provider body' }) }; } });
  await assert.rejects(p.preflight(), e => e.status === 503 && e.diagnostic.upstreamStatus === 401 && !/Alriz|secret/.test(e.message));
  assert.equal(calls, 1);
  const network = createAlrizMotionProvider({ env: { ALRIZ_API_KEY: 'secret' },
    fetcher: async () => { throw new Error('secret upstream token'); } });
  await assert.rejects(network.submit({}), e => e.uncertain && !e.message.includes('token'));
  const absent = createAlrizMotionProvider({ env: {}, fetcher: async () => assert.fail('Must not send') });
  await assert.rejects(absent.preflight(), MotionError);
});

test('Alriz HTTP failures distinguish definite rejections from uncertain paid submits', async () => {
  for (const [status, uncertain] of [[422, false], [401, false], [429, false], [500, true], [408, true]]) {
    let calls = 0;
    const p = createAlrizMotionProvider({ env: { ALRIZ_API_KEY: 'test' }, fetcher: async () => {
      calls++; return { ok: false, status };
    } });
    await assert.rejects(p.submit({}), e => e.uncertain === uncertain && e.diagnostic.upstreamStatus === status);
    assert.equal(calls, 1);
  }
});

test('Motion accepts existing raw base64 and supported data URIs without guessing new upstream fields', () => {
  const validate = motionRoutes.validateInput;
  assert.equal(validate({ characterImage: 'aGVsbG8=', referenceVideo: 'aGVsbG8=' }), 1);
  assert.equal(validate({ characterImage: 'data:image/webp;base64,aGVsbG8=', referenceVideo: 'data:video/quicktime;base64,aGVsbG8=' }), 1);
  assert.throws(() => validate({ characterImage: 'data:image/svg+xml;base64,aGVsbG8=', referenceVideo: 'aGVsbG8=' }), MotionError);
  assert.throws(() => validate({ characterImage: 'http://localhost/private', referenceVideo: 'aGVsbG8=' }), MotionError);
});

async function harness(t, options = {}) {
  const rows = [], records = [], queries = [];
  let submits = 0, preflights = 0, polls = 0, streamed;
  const query = async (sql, values = []) => {
    queries.push({ sql, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)|pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (sql.includes('SELECT max_users')) return { rows: [{ max_users: 100 }] };
    if (sql.includes('COUNT(DISTINCT')) return { rows: [{ active_users: 0 }] };
    if (sql.includes('INSERT INTO video_generation_tasks')) {
      const row = { task_id: values[0], xclip_api_key_id: values[1], user_id: values[2], room_id: values[3],
        model: values[4], retry_data: JSON.parse(values[5]), status: 'pending', created_at: new Date().toISOString() };
      rows.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (sql.includes('UPDATE xclip_api_keys')) return { rows: [] };
    if (sql.includes('UPDATE video_generation_tasks')) {
      const row = rows.find(r => r.task_id === values[0]);
      if (sql.includes("status = 'processing'")) {
        row.status = 'processing'; row.retry_data = JSON.parse(values[1]);
      } else if (sql.includes('completed_at = CASE')) {
        row.status = values[1]; row.video_url = values[2]; row.error_message = values[3]; row.retry_data = JSON.parse(values[4]);
      } else if (sql.includes('error_message = $3')) {
        row.status = values[1]; row.error_message = values[2]; Object.assign(row.retry_data, JSON.parse(values[3]));
      } else Object.assign(row.retry_data, JSON.parse(values[1]));
      return { rows: [structuredClone(row)] };
    }
    if (sql.includes("retry_data->>'requestHash' =")) {
      return { rows: rows.filter(r => r.xclip_api_key_id === values[0] && r.retry_data.requestHash === values[2]).map(r => structuredClone(r)) };
    }
    if (sql.includes('WHERE user_id = $1')) {
      return { rows: rows.filter(r => r.user_id === values[0]).map(r => structuredClone(r)) };
    }
    if (sql.includes("retry_data->>'jobId' IS NOT NULL")) {
      return { rows: rows.filter(r => r.retry_data.jobId && ['pending','processing'].includes(r.status)).map(r => structuredClone(r)) };
    }
    if (sql.includes('WHERE task_id = $1')) {
      const column = sql.includes('AND user_id = $2') ? 'user_id' : 'xclip_api_key_id';
      return { rows: rows.filter(r => r.task_id === values[0] && r[column] === values[1]).map(r => structuredClone(r)) };
    }
    throw new Error('Unhandled test SQL: ' + sql);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const provider = {
    preflight: async () => { preflights++; if (options.preflightError) throw options.preflightError; },
    submit: async () => { submits++; if (options.submitError) throw options.submitError; return 'ALRIZ_private_job'; },
    poll: async () => { polls++; return options.result || { status: 'processing' }; },
  };
  const router = motionRoutes({ pool, provider,
    validateKey: async key => key === 'owner' ? { id: 11, user_id: 9 } : key === 'other' ? { id: 22, user_id: 10 } : null,
    saveFile: async () => ({ publicUrl: 'https://xclip.example/uploads/test' }),
    stream: async (req, res, url) => { streamed = url; return res.type('video/mp4').send('fixture-video'); },
    logger: createGenerationLogger({ write: (level, record) => records.push(record) }),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/motion', router);
  app.get('/api/motion/tasks/:id', (req, res) => res.json({ legacy: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/motion`;
  async function request(path, body, key = 'owner', idem) {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { ...(key ? { 'x-xclip-key': key } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  }
  return { request, rows, records, queries, router, base,
    get submits() { return submits; }, get preflights() { return preflights; }, get polls() { return polls; }, get streamed() { return streamed; } };
}
const input = { model: 'kling-v2.6-pro', characterImage: 'https://example.com/image.png',
  referenceVideo: 'https://example.com/ref.mp4', prompt: 'move' };

test('Motion migration accepts legacy input, persists before submit, and exposes only Xclip task ids', async t => {
  const h = await harness(t);
  const r = await h.request('/generate', input, 'owner', 'test-request-123');
  assert.equal(r.status, 202);
  assert.match(r.body.taskId, /^xmc_[a-f0-9]{32}$/);
  assert.equal(h.rows[0].user_id, 9);
  assert.equal(h.rows[0].retry_data.jobId, 'ALRIZ_private_job');
  assert.ok(!/alriz|freepik|private_job/i.test(JSON.stringify(r.body)));
  assert.equal(h.submits, 1);
  assert.equal(h.preflights, 1);
  assert.ok(h.records.some(r => r.event === 'motion_accepted' && r.taskId === h.rows[0].task_id));
  const repeat = await h.request('/generate', input, 'owner', 'test-request-123');
  assert.equal(repeat.body.taskId, r.body.taskId);
  assert.equal(h.submits, 1);
  assert.equal((await h.request('/generate', { ...input, prompt: 'different' }, 'owner', 'test-request-123')).status, 409);
  assert.equal(h.rows[0].status, 'processing');
});
test('Motion ownership, old job polling, and required input are preserved', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/generate', input, null)).status, 401);
  assert.equal((await h.request('/generate', { ...input, referenceVideo: '' })).status, 400);
  assert.equal((await h.request('/generate', { ...input, model: 'wan-3.0' })).status, 400);
  assert.equal((await h.request('/generate', { ...input, characterOrientation: 'image' })).status, 400);
  assert.equal(h.submits, 0);
  const accepted = await h.request('/generate', input);
  const path = '/tasks/' + accepted.body.taskId;
  assert.equal((await h.request(path, null, 'other')).status, 404);
  assert.equal(h.polls, 0);
  assert.equal((await h.request('/tasks/old-freepik-task')).body.legacy, true);
  assert.equal((await h.request(path)).body.status, 'processing');
});
test('Motion unknown submit is durable, visible, and never resubmitted or rerouted', async t => {
  const h = await harness(t, { submitError: new MotionError(503, 'timeout', { uncertain: true }) });
  const r = await h.request('/generate', input);
  assert.equal(r.status, 503);
  assert.equal(h.rows[0].status, 'pending');
  assert.equal(h.rows[0].retry_data.phase, 'uncertain');
  assert.equal((await h.request('/generate', input)).status, 409);
  assert.equal(h.submits, 1);
  assert.equal(h.rows[0].status, 'pending');
  assert.match((await h.request('/tasks/' + r.body.taskId)).body.notice, /Jangan buat ulang/);
  await h.router.reconcile();
  assert.equal(h.submits, 1);
});
test('Motion rejected credentials fail before billable submit with sanitized diagnostic logs', async t => {
  const h = await harness(t, { preflightError: new MotionError(503, 'Kredensial layanan ditolak.', { upstreamStatus: 401 }) });
  const r = await h.request('/generate', input);
  assert.equal(r.status, 503);
  assert.equal(h.submits, 0);
  assert.equal(h.rows[0].status, 'failed');
  assert.ok(h.records.some(r => r.upstreamStatus === 401 && r.event === 'motion_request_failed'));
});
test('Motion completion and history use an authenticated Xclip media path, never the CDN URL', async t => {
  const h = await harness(t, { result: { status: 'completed', videoUrl: 'https://example.com/private-result.mp4' } });
  const r = await h.request('/generate', input);
  await h.router.reconcile();
  assert.equal(h.rows[0].status, 'completed');
  assert.match(h.rows[0].video_url, /^\/api\/motion\/tasks\/xmc_/);
  const status = await h.request('/tasks/' + r.body.taskId);
  assert.equal(status.body.videoUrl, h.rows[0].video_url);
  assert.ok(!JSON.stringify(status.body).includes('example.com'));
  const media = '/tasks/' + r.body.taskId + '/video';
  assert.equal((await fetch(h.base + media)).status, 401);
  assert.equal((await fetch(h.base + media, { headers: { 'x-xclip-key': 'other' } })).status, 404);
  const video = await fetch(h.base + media, { headers: { 'x-xclip-key': 'owner' } });
  assert.equal(video.status, 200);
  assert.equal(await video.text(), 'fixture-video');
  assert.equal(h.streamed, 'https://example.com/private-result.mp4');
  assert.equal(h.submits, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createSeedanceUpscale } = require('../server/seedance-upscale');
const { createRenderfulUpscaleProvider } = require('../server/renderful-upscale-provider');
const { verify1080p } = require('../server/video-resolution');

const source = { status: 'completed', videoUrl: 'https://source.example/private.mp4' };
const finalUrl = 'https://result.example/1080.mp4';
const logger = { info() {}, warn() {}, error() {} };

function fixture(options = {}) {
  const state = {
    row: { task_id: 'xv_' + 'a'.repeat(64), model: 'seedance-2.5', status: 'processing',
      retry_data: { runId: 'source-job', billing: 'wallet', upscale: {
        required: true, phase: 'waiting_source', keyId: 7, duration: 30, ...options.state,
      } } },
    submits: 0, polls: 0, verifies: 0, releases: 0, snapshots: [],
  };
  let tail = Promise.resolve();
  const pool = { async connect() {
    let unlock;
    return { async query(sql, params) {
      if (sql.includes('pg_advisory_unlock')) { unlock?.(); return { rows: [] }; }
      if (sql.includes('pg_advisory_lock')) {
        const previous = tail;
        tail = new Promise(resolve => { unlock = resolve; });
        await previous;
        return { rows: [] };
      }
      if (sql.startsWith('SELECT *')) return { rows: [structuredClone(state.row)] };
      if (sql.includes('jsonb_set')) {
        state.row.retry_data.upscale = JSON.parse(params[1]);
        state.snapshots.push(structuredClone(state.row.retry_data.upscale));
        return { rows: [] };
      }
      throw new Error('Unexpected SQL');
    }, release() { state.releases++; } };
  } };
  const provider = {
    async context() { return { keyId: 7 }; },
    async submit(keyId, url, duration) {
      state.submits++;
      assert.equal(state.row.retry_data.upscale.phase, 'submitting');
      assert.equal(keyId, 7); assert.equal(url, source.videoUrl); assert.equal(duration, 30);
      if (options.submitError) throw options.submitError;
      return 'render-job';
    },
    async poll() { state.polls++; return options.result || { status: 'completed', videoUrl: finalUrl }; },
  };
  const create = () => createSeedanceUpscale({ pool, provider, logger,
    verify: async url => {
      state.verifies++; assert.equal(url, finalUrl);
      if (options.verifyError) throw options.verifyError;
      return options.validResolution !== false;
    } });
  return { state, create, pipeline: create() };
}

test('source completion cannot publish 480p; saved upscale resumes after restart and verifies before completion', async () => {
  const h = fixture();
  assert.deepEqual(await h.pipeline.process(h.state.row, { status: 'processing' }), { status: 'processing' });
  assert.equal(h.state.submits, 0);
  assert.deepEqual(await h.pipeline.process(h.state.row, source), { status: 'processing' });
  assert.equal(h.state.submits, 1);
  assert.equal(h.state.row.retry_data.upscale.runId, 'render-job');
  const result = await h.create().process(h.state.row, null);
  assert.deepEqual(result, { status: 'completed', videoUrl: finalUrl });
  assert.equal(h.state.row.retry_data.upscale.phase, 'verified');
  assert.equal(h.state.submits, 1);
  await h.create().process(h.state.row, null);
  assert.equal(h.state.verifies, 1);
});

test('concurrent pollers serialize paid upscale dispatch and never submit twice', async () => {
  const h = fixture();
  const results = await Promise.all([h.create().process(h.state.row, source), h.create().process(h.state.row, source)]);
  assert.equal(h.state.submits, 1);
  assert.ok(results.some(r => r.status === 'completed'));
  assert.equal(h.state.releases, 2);
});

test('a crash or an uncertain paid response never automatically dispatches a second upscale', async () => {
  for (const phase of ['submitting', 'uncertain']) {
    const h = fixture({ state: { phase, sourceUrl: source.videoUrl } });
    assert.deepEqual(await h.pipeline.process(h.state.row, null), { status: 'processing' });
    assert.equal(h.state.submits, 0);
  }
  const h = fixture({ submitError: Object.assign(new Error('private provider response'), { deliveryUncertain: true }) });
  assert.deepEqual(await h.pipeline.process(h.state.row, source), { status: 'processing' });
  assert.equal(h.state.row.retry_data.upscale.phase, 'uncertain');
  await h.create().process(h.state.row, null);
  assert.equal(h.state.submits, 1);
});

test('definitive rejection, failed upscale or low-resolution output fail without publishing source', async () => {
  const rejected = fixture({ submitError: Object.assign(new Error('private'), {
    diagnostic: { reason: 'upstream_auth_failed' }, deliveryUncertain: false,
  }) });
  assert.equal((await rejected.pipeline.process(rejected.state.row, source)).status, 'failed');
  for (const options of [{ result: { status: 'failed' } }, { validResolution: false }]) {
    const h = fixture(options);
    await h.pipeline.process(h.state.row, source);
    const result = await h.create().process(h.state.row, null);
    assert.equal(result.status, 'failed');
    assert.equal(result.videoUrl, undefined);
    assert.equal(h.state.row.retry_data.upscale.phase, 'failed');
  }
});

test('in-progress upscale and transient verification error keep the source private and never regenerate', async () => {
  const pending = fixture({ result: { status: 'processing' } });
  await pending.pipeline.process(pending.state.row, source);
  assert.deepEqual(await pending.create().process(pending.state.row, null), { status: 'processing' });
  const h = fixture({ verifyError: new Error('network failure') });
  await h.pipeline.process(h.state.row, source);
  await assert.rejects(h.create().process(h.state.row, null));
  await assert.rejects(h.create().process(h.state.row, null));
  assert.equal(h.state.submits, 1);
  assert.equal(h.state.polls, 1);
  assert.equal(h.state.row.retry_data.upscale.phase, 'verifying');
});

test('Renderful uses only eligible DB keys, documented REST contract and same-key polling', async () => {
  const calls = [], queries = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    return { rows: [{ id: 7, api_key: 'test-secret' }] };
  } };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, async json() {
      if (url.endsWith('/account/balance')) return { balance_available: '1.00' };
      if (url.endsWith('/generations')) return { id: 'gen_test', status: 'queued' };
      return { status: 'completed', outputs: [finalUrl] };
    } };
  };
  const p = createRenderfulUpscaleProvider(pool, fetcher);
  assert.deepEqual(await p.context(30), { keyId: 7 });
  assert.match(queries[0].sql, /assigned_to IS NULL/);
  assert.match(queries[0].sql, /dead_at IS NULL/);
  assert.equal(await p.submit(7, source.videoUrl, 30), 'gen_test');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    type: 'video-to-video', model: 'bytedance-video-upscaler', video_url: source.videoUrl,
    resolution: '1080p', duration: 30,
  });
  assert.deepEqual(await p.poll(7, 'gen_test'), { status: 'completed', videoUrl: finalUrl });
  assert.deepEqual(queries.at(-1).params, [7]);
  for (const c of calls) { assert.equal(c.options.redirect, 'error'); assert.ok(c.options.signal); }
  await assert.rejects(p.submit(7, 'http://127.0.0.1/test.mp4', 30));
});

test('Renderful preflight rejects missing/insufficient keys; POST failures are sanitized and uncertainty preserved', async () => {
  await assert.rejects(createRenderfulUpscaleProvider({ query: async()=>({ rows: [] }) }).context(30),
    error => error.diagnostic.reason === 'generation_credentials_missing');
  const pool = { query: async()=>({ rows: [{ id: 7, api_key: 'test-secret' }] }) };
  await assert.rejects(createRenderfulUpscaleProvider(pool, async()=>({
    ok: true, json: async()=>({ balance_available: '0.1' }),
  })).context(30), error => error.diagnostic.reason === 'upstream_insufficient_credits');
  for (const status of [400, 401, 408, 429, 500]) {
    let calls = 0;
    const p = createRenderfulUpscaleProvider(pool, async()=>{ calls++; return { ok: false, status }; });
    await assert.rejects(p.submit(7, source.videoUrl, 30),
      error => error.deliveryUncertain === (status === 408 || status >= 500) && !/Renderful|test-secret/.test(error.message));
    assert.equal(calls, 1);
  }
  for (const f of [async()=>{ throw new Error('secret'); }, async()=>({ ok:true, json:async()=>({}) })]) {
    await assert.rejects(createRenderfulUpscaleProvider(pool, f).submit(7, source.videoUrl, 30),
      error => error.deliveryUncertain === true);
  }
});

test('resolution check uses a DNS-protected local download and rejects 480p in both orientations', async () => {
  const request = async (url, options) => {
    assert.ok(options.httpAgent && options.httpsAgent);
    assert.equal(options.maxRedirects, 0); assert.equal(options.proxy, false);
    return { status: 200, headers: { 'content-type': 'video/mp4' }, data: Readable.from([Buffer.from('mock-video')]) };
  };
  for (const [width, height, valid] of [[1920,1080,true],[1080,1920,true],[854,480,false],[480,854,false]]) {
    const probe = async (command, args) => {
      assert.equal(command, 'ffprobe');
      assert.ok(args.includes('file'));
      assert.equal(args.some(x => x.includes('https://')), false);
      return { stdout: JSON.stringify({ streams: [{ width, height }] }) };
    };
    assert.equal(await verify1080p(finalUrl, request, probe), valid);
  }
  await assert.rejects(verify1080p('http://127.0.0.1/secret', request));
  await assert.rejects(verify1080p(finalUrl, async()=>({
    status:302,headers:{location:'http://169.254.169.254/secret'},data:Readable.from([]),
  })));
  assert.equal(await verify1080p(finalUrl,request,async()=>{throw {code:1,killed:false};}),false);
  await assert.rejects(verify1080p(finalUrl,request,async()=>{throw {code:'ENOENT'};}));
});

test('real ffprobe distinguishes local 1080p and 480p fixtures without any paid generation', {timeout:30000}, async () => {
  const fs = require('node:fs/promises');
  const {createReadStream} = require('node:fs');
  const {execFile} = require('node:child_process');
  const exec = require('node:util').promisify(execFile);
  const dir = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(),'xclip-test-video-'));
  try {
    for(const [size, valid] of [['1920x1080',true],['854x480',false]]) {
      const file = require('node:path').join(dir,size+'.mp4');
      await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s='+size,
        '-frames:v','1','-c:v','libx264','-preset','ultrafast',file],{timeout:10000});
      const request = async()=>({status:200,headers:{'content-type':'video/mp4'},data:createReadStream(file)});
      assert.equal(await verify1080p(finalUrl,request),valid);
    }
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

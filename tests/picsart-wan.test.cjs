const test = require('node:test');
const assert = require('node:assert/strict');
const { createPicsartWanProvider } = require('../server/picsart-wan-provider');
const { validateInput } = require('../server/wan-provider');
const { MODELS } = require('../server/video-models');

const png = 'data:image/png;base64,iVBORw0KGgo=';
function fixture(overrides = {}) {
  const calls = [], queries = [];
  const pool = { async query(sql, params) {
    queries.push({sql,params});
    return { rows: overrides.noCredentials ? [] : [{id: params?.[0] || 12, access_token:'fake-db-token'}] };
  } };
  const request = async options => {
    calls.push(options);
    if (overrides.request) return overrides.request(options);
    const path = new URL(options.url).pathname;
    const response = path === '/guard/credits' ? {credits:overrides.credits ?? 250}
      : path.endsWith('/options') ? {credits:60,usageAmount:30,estimated:false}
      : path === '/v2/files' ? {url:'https://cdn.picsart.com/reference.png'}
      : path.endsWith('/submit') ? {id:'fake-workflow-id'}
      : {id:'fake-workflow-id',status:overrides.status || 'COMPLETED',
        result:{url:overrides.videoUrl || 'https://cdn.picsart.com/result.mp4?token=private'},
        progress:{percent:46}};
    return {data:{status:'success',response}};
  };
  return {provider:createPicsartWanProvider(pool,request),calls,queries};
}

test('separate Wan 3.0 has a fixed verified 30s contract and does not acquire an uncensored flag', () => {
  const input=validateInput({model:'wan-3.0',prompt:'test'});
  assert.equal(input.duration,30);
  assert.equal(MODELS['wan-3.0'].pricePerVideo,6500);
  assert.equal(MODELS['wan-3.0-uncensored'].pricePerVideo,6000);
  for(const extra of [{duration:2},{duration:29},{resolution:'720p'},{aspectRatio:'1:1'},{uncensored:true}]) {
    assert.throws(()=>validateInput({model:'wan-3.0',prompt:'test',...extra}),e=>e.status===400);
  }
});

test('Picsart adapter uses database accounts and captured quote/submit/result contract, with one paid submit', async () => {
  const h=fixture();
  const prepared=await h.provider.prepare(validateInput({model:'wan-3.0',prompt:'safe landscape',aspectRatio:'9:16'}));
  assert.deepEqual(prepared.body,{params:{
    model:'wan3.0-video',resolution:'480P',ratio:'9:16',duration:30,audio:true,
    enable_thinking:false,watermark:false,prompt:'safe landscape',
    options:{inputs_transformation:{downscale_oversized_images:true}},
  }});
  assert.equal(h.calls.filter(c=>c.url.endsWith('/submit')).length,0);
  assert.equal(await h.provider.start(prepared),'fake-workflow-id');
  const result=await h.provider.poll({keyId:12,runId:'fake-workflow-id',pollUrl:'https://attacker.test'});
  assert.equal(result.status,'completed');
  assert.equal(result.progress,46);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/submit')).length,1);
  assert.equal(h.calls.at(-1).url,'https://api.picsart.com/gw-v2/workflows/wan/v3/video/fake-workflow-id/result');
  assert.deepEqual(h.queries.at(-1).params,[12]);
  assert.match(h.queries[0].sql,/pool = 'p500'/);
  assert.match(h.queries[0].sql,/NOT EXISTS/);
  assert.match(h.queries[0].sql,/access_expires_at >/);
  for(const call of h.calls) {
    assert.equal(call.headers['X-App-Authorization'],'Bearer fake-db-token');
    assert.equal(call.maxRedirects,0);
    assert.equal(call.headers.Cookie,undefined);
  }
});

test('image mode uploads data URI via captured multipart endpoint, not user-controlled upstream URLs', async () => {
  const h=fixture();
  const p=await h.provider.prepare({model:'wan-3.0',prompt:'landscape',image:png});
  const upload=h.calls.find(c=>c.url==='https://upload.picsart.com/v2/files');
  assert.ok(upload.headers['content-type'].startsWith('multipart/form-data; boundary='));
  const body=upload.data.getBuffer().toString('latin1');
  assert.ok(body.includes('name="file"; filename="reference.png"'));
  assert.ok(body.includes('editing-temp'));
  assert.deepEqual(p.body.params.media,[{type:'reference_image',url:'https://cdn.picsart.com/reference.png'}]);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/submit')).length,0);
});

test('pool missing or insufficient credits fails before a paid call', async () => {
  for(const opts of [{noCredentials:true},{credits:59}]) {
    const h=fixture(opts);
    await assert.rejects(h.provider.prepare({model:'wan-3.0',prompt:'test'}),e=>e.status===503);
    assert.equal(h.calls.filter(c=>c.url.endsWith('/submit')).length,0);
  }
});

test('captured ACCEPTED/IN_PROGRESS/COMPLETED map to public statuses without interpreting partial progress as success', async () => {
  for(const [status,expected] of [['ACCEPTED','pending'],['IN_PROGRESS','processing'],['COMPLETED','completed'],['FAILED','failed']]) {
    const h=fixture({status});
    const result=await h.provider.poll({keyId:12,runId:'fake-workflow-id'});
    assert.equal(result.status,expected);
    assert.equal(!!result.videoUrl,expected==='completed');
  }
  for(const opts of [{status:'UNKNOWN'},{videoUrl:'http://127.0.0.1/private'}]) {
    const h=fixture(opts);
    await assert.rejects(h.provider.poll({keyId:12,runId:'fake-workflow-id'}),e=>e.status===503);
  }
});

test('submit timeout, 5xx and malformed success remain uncertain with no retry or raw credential leakage', async () => {
  for(const mode of ['timeout','server','malformed','rejected']) {
    const h=fixture({request:async()=>{
      if(mode==='malformed') return {data:{status:'success',response:{}}};
      throw Object.assign(new Error('Picsart fake-db-token raw secret'),mode==='timeout'?{code:'ECONNABORTED'}:
        {response:{status:mode==='server'?503:400,data:{secret:'private'}}});
    }});
    await assert.rejects(h.provider.start({keyId:12,body:{}}),error=>{
      assert.equal(error.deliveryUncertain,mode!=='rejected');
      assert.ok(!/picsart|fake-db-token|raw secret|private/i.test(JSON.stringify(error)));
      assert.ok(!/picsart|fake-db-token/i.test(error.message));
      return error.status===503;
    });
    assert.equal(h.calls.length,1);
  }
});

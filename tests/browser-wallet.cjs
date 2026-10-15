// Manual UI smoke check. All API calls are browser-local fixtures, never live payments.
// Run with a serving app: node tests/browser-wallet.cjs (CHROMIUM_PATH can override the binary).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const profile = `/tmp/xclip-wallet-qa-${process.pid}`;
const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  ['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-pipe',`--user-data-dir=${profile}`],
  { stdio:['ignore','ignore','ignore','pipe','pipe'] });
let sequence=0, incoming='', session, invoice=null, paid=false;
let generationFailed=false, generationError=false;
const pending=new Map(), creates=[], errors=[];
function send(method,params={},sid=session) {
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser timeout: ${method}`));},15000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');
  });
}
function crc(bytes) {
  let c=0xffffffff;
  for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^0xffffffff)>>>0;
}
function chunk(type,bytes) {
  const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc(Buffer.concat([name,bytes])));
  return Buffer.concat([length,name,bytes,checksum]);
}
// Deliberately not a scannable QR: valid PNG checkerboard for image/layout verification.
const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=2;
const pixels=Buffer.alloc(193*64);
for(let y=0;y<64;y++)for(let x=0;x<64;x++)pixels.fill(((x>>3)+(y>>3))%2?32:255,y*193+1+x*3,y*193+4+x*3);
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),
  chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
async function intercept(p) {
  const path=new URL(p.request.url).pathname;
  let data,body,type='application/json',responseCode=200;
  if(path==='/api/auth/me')data={user:{id:900001,username:'UI test developer'}};
  else if(path==='/api/developer/overview')data={keys:[],hasLifetimeKey:false,totalRequests:0};
  else if(path==='/api/developer/models')data={models:[
    {id:'wan-3.0-uncensored',name:'Wan 3.0 Uncensored',status:'available',pricePerVideo:6000},
    {id:'wan-3.0',name:'Wan 3.0',status:'available',pricePerVideo:6500},
    {id:'seedance-2.5',name:'Seedance 2.5',status:'available',pricePerVideo:11000},
    {id:'seedance-2.0',name:'Seedance 2.0',status:'available',pricePerVideo:5000}]};
  else if(path==='/api/developer/generations') {
    responseCode=generationError?503:200;
    data=generationError?{error:'Riwayat sementara tidak tersedia'}:{tasks:[
      {taskId:'xv_'+ 'a'.repeat(64),model:'wan-3.0-uncensored',status:'completed',
        createdAt:'2026-10-15T00:00:00Z',videoUrl:'/api/videogen/proxy-video?taskId=xv_test'},
      {taskId:'xv_'+ 'b'.repeat(64),model:'wan-3.0-uncensored',status:generationFailed?'failed':'processing',
        createdAt:'2026-10-15T00:00:00Z',error:generationFailed?'Generasi video gagal. Saldo dikembalikan.':undefined},
    ],page:Number(new URL(p.request.url).searchParams.get('page')||1),hasMore:false};
  }
  else if(path==='/api/subscription/status')data={hasSubscription:false};
  else if(path==='/api/developer/wallet')data={balance:paid?100000:0,reserved:0,videoPrice:6000,
    minimumTopup:100000,maximumTopup:100000000,currency:'IDR',expires:false};
  else if(path==='/api/payments/my')data={payments:invoice?[{...invoice,status:paid?'paid':'pending'}]:[]};
  else if(path==='/api/payments/klikqris/config')data={available:true,sandbox:false};
  else if(path==='/api/payments/klikqris/current')data={invoice:invoice?{...invoice,status:paid?'paid':'pending',qr_url:paid?null:invoice.qr_url}:null};
  else if(path==='/api/payments/klikqris/create') {
    creates.push(p.request);
    await new Promise(resolve=>setTimeout(resolve,1000));
    invoice={id:'xq_11111111111111111111111111111111',provider:'klikqris',billing_type:'wallet',
      package:'Top up saldo API',amount:100000,total_amount:100021,status:'pending',
      created_at:new Date().toISOString(),expires_at:'2030-01-01T03:00:00Z',
      qr_url:'/api/payments/klikqris/xq_11111111111111111111111111111111/qr'};
    data={success:true,invoice};
  } else if(path===invoice?.qr_url){body=png;type='image/png';}
  else if(path==='/api/payments/klikqris/xq_11111111111111111111111111111111')
    data={invoice:{...invoice,status:paid?'paid':'pending',qr_url:paid?null:invoice.qr_url}};
  else {
    errors.push(`Unexpected API blocked: ${path}`);
    await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});
    return;
  }
  await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode,
    responseHeaders:[{name:'Content-Type',value:type},{name:'Cache-Control',value:'no-store'}],
    body:(body||Buffer.from(JSON.stringify(data))).toString('base64')});
}
browser.stdio[4].on('data',buffer=>{
  incoming+=buffer.toString();
  let split;
  while((split=incoming.indexOf('\0'))>=0) {
    const line=incoming.slice(0,split);incoming=incoming.slice(split+1);if(!line)continue;
    const m=JSON.parse(line), item=pending.get(m.id);
    if(item){clearTimeout(item.timer);pending.delete(m.id);m.error?item.reject(new Error(m.error.message)):item.resolve(m.result);}
    else if(m.method==='Fetch.requestPaused')intercept(m.params).catch(e=>errors.push(e.message));
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  }
});
async function evaluate(expression) {
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function wait(expression) {
  for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}
  throw new Error(`Condition not met: ${expression}`);
}
async function screenshot(path){const r=await send('Page.captureScreenshot',{format:'jpeg',quality:70});fs.writeFileSync(path,Buffer.from(r.data,'base64'));}
(async()=>{
  try {
    const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
    session=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
    await send('Page.enable');await send('Runtime.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:'*://*/api/*'}]});
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:process.env.WALLET_QA_URL||'http://127.0.0.1:5000/'});
    await wait("!!document.querySelector('#payment-form button[type=submit]') && !document.querySelector('#payment-form button[type=submit]').disabled");
    await wait("document.querySelectorAll('.xp-generation-row').length === 2");
    assert.equal(await evaluate("document.querySelectorAll('.xp-model-card').length"),4);
    await evaluate("document.querySelector('[data-action=\"doc-model\"][data-model-id=\"wan-3.0\"]').click()");
    assert.equal(await evaluate("document.querySelector('#dokumentasi').textContent.includes('6.500')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi pre').textContent.includes('\"model\": \"wan-3.0\"')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi').textContent.includes('Durasi hanya 30 detik')"),true);
    await evaluate("document.querySelector('[data-action=\"doc-model\"][data-model-id=\"seedance-2.5\"]').click()");
    assert.equal(await evaluate("document.querySelector('#dokumentasi pre').textContent.includes('\"model\": \"seedance-2.5\"')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi').textContent.includes('11.000')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi').textContent.includes('Durasi hanya 30 detik')"),true);
    await evaluate("document.querySelector('[data-action=\"doc-model\"][data-model-id=\"seedance-2.0\"]').click()");
    assert.equal(await evaluate("document.querySelector('#dokumentasi pre').textContent.includes('\"model\": \"seedance-2.0\"')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi pre').textContent.includes('\"duration\": 15')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi').textContent.includes('5.000')"),true);
    assert.equal(await evaluate("document.querySelector('#dokumentasi').textContent.includes('Durasi hanya 15 detik')"),true);
    assert.equal(await evaluate("/flora|picsart/i.test(document.body.textContent)"),false);
    await evaluate("document.querySelector('#model').scrollIntoView()");
    await screenshot('/tmp/xclip-models-desktop.jpg');
    assert.equal(await evaluate("document.querySelectorAll('.xp-generation-download').length"),1);
    await evaluate("document.querySelector('#payment-amount').value='123456'; document.querySelector('#payment-amount').focus()");
    generationFailed=true;
    await wait("!!document.querySelector('.xp-generation-failed')");
    assert.equal(await evaluate("document.querySelector('#payment-amount').value"),'123456');
    assert.equal(await evaluate("document.activeElement.id"),'payment-amount');
    generationError=true;
    await evaluate("document.querySelector('[data-action=\"generations-refresh\"]').click()");
    await wait("!!document.querySelector('.xp-generation-error')");
    generationError=false;
    await evaluate("document.querySelector('.xp-generation-error [data-action=\"generations-refresh\"]').click()");
    await wait("document.querySelectorAll('.xp-generation-row').length === 2");
    await evaluate("document.querySelector('#generasi').scrollIntoView()");
    await screenshot('/tmp/xclip-generation-desktop.jpg');
    assert.equal(await evaluate("document.body.textContent.includes('1 Hari')"),false);
    assert.equal(await evaluate("document.querySelector('#payment-amount').min"),'100000');
    await evaluate("document.querySelector('#payment-amount').value='99999'; document.querySelector('#payment-form button[type=submit]').click()");
    assert.equal(await evaluate("document.querySelector('#payment-amount').checkValidity()"),false);
    assert.equal(creates.length,0);
    await evaluate("document.querySelector('#payment-amount').value='100000'; document.querySelector('#payment-form button[type=submit]').click()");
    await wait("document.querySelector('#payment-form button[type=submit]')?.getAttribute('aria-busy') === 'true'");
    assert.equal(await evaluate("document.querySelector('#payment-form button[type=submit]').textContent.includes('Sedang membuat QRIS')"),true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#payment-form button[type=submit]')).cursor"),'wait');
    await wait("document.querySelector('#qris-image')?.naturalWidth > 0");
    assert.equal(creates.length,1);assert.deepEqual(JSON.parse(creates[0].postData),{amount:100000});
    assert.ok(Object.keys(creates[0].headers).some(k=>k.toLowerCase()==='idempotency-key'));
    assert.equal(await evaluate("document.querySelector('#payment-form button[type=submit]').disabled"),true);
    assert.equal(await evaluate("document.querySelector('#payment-form button[type=submit]').getAttribute('aria-busy')"),'false');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#payment-form button[type=submit]')).cursor"),'not-allowed');
    assert.equal(await evaluate("document.querySelector('#topup').textContent.includes('100.021')"),true);
    assert.equal(await evaluate("document.querySelector('#topup').textContent.includes('bukan masa aktif saldo')"),true);
    await evaluate("document.querySelector('#topup').scrollIntoView()");
    await screenshot('/tmp/xclip-wallet-desktop.jpg');
    await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true});
    await evaluate("document.querySelector('#model').scrollIntoView()");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 402'),true);
    await screenshot('/tmp/xclip-models-mobile.jpg');
    await evaluate("document.querySelector('#topup').scrollIntoView()");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= 402'),true);
    await screenshot('/tmp/xclip-wallet-mobile.jpg');
    await evaluate("window.__paymentQrNode = document.querySelector('#qris-image')");
    await new Promise(resolve=>setTimeout(resolve,16000));
    assert.equal(await evaluate("window.__paymentQrNode === document.querySelector('#qris-image')"),true);
    assert.equal(creates.length,1);
    paid=true;
    await evaluate("document.querySelector('[data-action=\"payment-check\"]').click()");
    await wait("document.body.textContent.includes('Saldo API sudah ditambahkan')");
    assert.equal(await evaluate("!!document.querySelector('#qris-image')"),false);
    assert.equal(await evaluate("document.querySelector('#akses').textContent.includes('100.000')"),true);
    assert.equal(await evaluate("document.body.textContent.includes('1 Hari')"),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({mocked_wallet_ui:'passed',minimum:100000,video_price:6000,
      final_payment:100021,credited_balance:100000,expired_balance:false,mobile_no_overflow:true,
       actual_api_mutations:0,qr_stable_across_automatic_poll:true,screenshots:['/tmp/xclip-wallet-desktop.jpg','/tmp/xclip-wallet-mobile.jpg']}));
  } catch(e){console.error('Mocked wallet browser verification failed:',e.message);process.exitCode=1;}
  finally {
    for(const p of pending.values())clearTimeout(p.timer);
    browser.kill();
    setTimeout(()=>{fs.rmSync(profile,{recursive:true,force:true});process.exit(process.exitCode||0);},300);
  }
})();

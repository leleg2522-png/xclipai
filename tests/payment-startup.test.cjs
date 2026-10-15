const test = require('node:test');
const assert = require('node:assert/strict');
const { startPaymentStorage } = require('../server/payment-startup');

const tick = () => new Promise(resolve => setImmediate(resolve));
test('payment storage starts independently and retries startup failures without duplicate workers', async () => {
  let paymentCalls = 0, walletCalls = 0, workers = 0;
  const retry = [], errors = [];
  const stop = startPaymentStorage({
    payments: { async initialize() {
      paymentCalls++;
      if (paymentCalls === 1) throw Object.assign(new Error('secret must not be logged'), { code: '42P01' });
    } },
    wallet: { async initialize() { walletCalls++; } },
    onReady() { workers++; },
    logger: { log() {}, error(...args) { errors.push(args.join(' ')); } },
    schedule(fn, delay) { assert.equal(delay, 5000); retry.push(fn); return { unref() {} }; },
  });
  await tick();
  assert.equal(paymentCalls, 1);
  assert.equal(walletCalls, 0);
  assert.equal(workers, 0);
  assert.equal(retry.length, 1);
  assert.ok(!errors.join('').includes('secret'));
  await retry.shift()();
  assert.equal(paymentCalls, 2);
  assert.equal(walletCalls, 1);
  assert.equal(workers, 1);
  assert.equal(retry.length, 0);
  stop();
});

test('wallet initialization failure is retryable and does not mark payments usable early', async () => {
  let calls = 0, workers = 0, retry;
  const stop = startPaymentStorage({
    payments: { async initialize() {} },
    wallet: { async initialize() { if (++calls === 1) throw new Error('temporary DB error'); } },
    onReady() { workers++; },
    logger: { log() {}, error() {} },
    schedule(fn) { retry = fn; return { unref() {} }; },
  });
  await tick();
  assert.equal(workers, 0);
  await retry();
  assert.equal(workers, 1);
  stop();
});

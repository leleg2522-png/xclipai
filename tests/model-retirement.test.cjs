const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const rejectRetired = require('../server/model-retirement');
const { MODELS, MODEL_IDS, ACTIVE_MODEL_IDS, modelPrices } = require('../server/video-models');

test('retired Wan remains internal for settlement but is absent from the active catalog', () => {
  assert.deepEqual(ACTIVE_MODEL_IDS, ['wan-3.0', 'seedance-2.5', 'seedance-2.0']);
  assert.ok(MODEL_IDS.includes('wan-3.0-uncensored'));
  assert.equal(MODELS['wan-3.0-uncensored'].retired, true);
  assert.equal(modelPrices['wan-3.0-uncensored'], 6000);
  assert.equal(modelPrices['wan-3.0'], 6500);
  assert.equal(modelPrices['seedance-2.5'], 11000);
  assert.equal(modelPrices['seedance-2.0'], 5000);
  const source = fs.readFileSync('server/wan-routes.js', 'utf8');
  assert.ok(source.includes('ACTIVE_MODEL_IDS.map'));
  assert.ok(source.includes('[auth.id, MODEL_IDS, (page - 1) * 20]'));
  assert.ok(source.includes('[req.params.taskId, auth.id, MODEL_IDS]'));
});

test('public retired submissions stop before dispatch, wallet, or legacy fallback; historical GET remains possible', async t => {
  let dispatched = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/videogen/proxy', rejectRetired);
  app.post('/api/videogen/proxy', (_req, res) => { dispatched++; res.status(202).json({ accepted: true }); });
  app.get('/api/videogen/tasks/:taskId', (_req, res) => res.json({ historical: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const model of ['wan-3.0-uncensored', ' WAN-3.0-UNCENSORED ']) {
    const response = await fetch(base + '/api/videogen/proxy/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
    });
    assert.equal(response.status, 410);
    assert.equal((await response.json()).code, 'MODEL_RETIRED');
  }
  assert.equal(dispatched, 0);
  const active = await fetch(base + '/api/videogen/proxy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'wan-3.0' }),
  });
  assert.equal(active.status, 202);
  assert.equal(dispatched, 1);
  assert.equal((await fetch(base + '/api/videogen/tasks/historical')).status, 200);
  const source = fs.readFileSync('server.js', 'utf8');
  assert.ok(source.indexOf("app.use('/api/videogen/proxy', require('./server/model-retirement'))") <
    source.indexOf('app.use(wanRouter)'));
});

test('browser model choices and docs no longer offer Uncensored', () => {
  for (const file of ['client/src/developer.js', 'client/src/developer-views.js']) {
    assert.ok(!/uncensored/i.test(fs.readFileSync(file, 'utf8')), file);
  }
});

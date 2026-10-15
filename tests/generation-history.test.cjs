const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const wanRoutes = require('../server/wan-routes');

async function fixture(work, failing = false, empty = false) {
  const queries = [];
  const rows = Array.from({ length: 21 }, (_, n) => ({
    task_id: `xv_${String(n).padStart(64, '0')}`, model: ['wan-3.0-uncensored','wan-3.0','seedance-2.5','seedance-2.0'][n % 4],
    status: ['completed', 'failed', 'pending', 'processing'][n % 4],
    created_at: '2026-10-15T00:00:00Z', completed_at: n === 0 ? '2026-10-15T00:01:00Z' : null,
    has_video: n === 0, delivery: 'uncertain',
    // Projection must not accidentally spread even unexpected database properties.
    api_key: 'secret', video_url: 'https://media.flora.ai/secret', retry_data: { runId: 'internal' },
    error_message: 'Picsart Flora secret payload',
  }));
  const app = express();
  app.use((req, res, next) => { req.session = { userId: req.headers['x-test-user'] ? 42 : null }; next(); });
  app.use(wanRoutes({
    pool: { async query(sql, params) {
      queries.push({ sql, params });
      if (failing) throw new Error('Flora internal SQL secret');
      return { rows: empty ? [] : rows };
    } },
    provider: { context() { throw new Error('history must not call provider'); } },
    validateKey: async key => key === 'valid' ? { id: 9, user_id: 42 } : null,
    logger: { info() {}, warn() {}, error() {} },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await work(`http://127.0.0.1:${server.address().port}`, queries); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('generation history requires authentication; invalid key cannot fall back to session', async () => {
  await fixture(async (base, queries) => {
    for (const headers of [{}, { 'x-xclip-key': 'revoked', 'x-test-user': '42' }]) {
      const res = await fetch(base + '/api/developer/generations', { headers });
      assert.equal(res.status, 401);
      assert.match(res.headers.get('cache-control'), /no-store/);
    }
    assert.equal(queries.length, 0);
  });
});

test('empty history is a successful explicit empty page', async () => {
  await fixture(async base => {
    const res = await fetch(base + '/api/developer/generations', { headers: { 'x-test-user': '42' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { tasks: [], page: 1, hasMore: false });
  }, false, true);
});

test('history is owner scoped, paginated and sanitized for sessions and API keys', async () => {
  await fixture(async (base, queries) => {
    for (const [headers, column, id] of [
      [{ 'x-test-user': '42' }, 'user_id', 42], [{ 'x-xclip-key': 'valid' }, 'xclip_api_key_id', 9],
    ]) {
      const res = await fetch(base + '/api/developer/generations?page=2', { headers });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.tasks.length, 20);
      assert.equal(data.page, 2);
      assert.equal(data.hasMore, true);
      assert.ok(data.tasks[0].videoUrl.startsWith('/api/videogen/proxy-video?taskId='));
      assert.equal(data.tasks[1].error.includes('gagal'), true);
      assert.equal(data.tasks[2].notice.includes('Jangan kirim ulang'), true);
      assert.equal(data.tasks[3].videoUrl, null);
      assert.ok(!/flora|picsart|secret|retry_data|runId|api_key|video_url/i.test(JSON.stringify(data)));
      const query = queries.at(-1);
      assert.match(query.sql, new RegExp(`WHERE ${column} = \\$1 AND model = ANY\\(\\$2::text\\[\\]\\)`));
      assert.deepEqual(query.params, [id, ['wan-3.0-uncensored','wan-3.0','seedance-2.5','seedance-2.0'], 20]);
      assert.equal(data.tasks[1].model,'wan-3.0');
      assert.equal(data.tasks[2].model,'seedance-2.5');
      assert.equal(data.tasks[3].model,'seedance-2.0');
      assert.match(query.sql, /LIMIT 21 OFFSET \$3/);
    }
  });
});

test('history rejects invalid pagination and reports database failures without raw details', async () => {
  await fixture(async (base, queries) => {
    for (const page of ['0', '-1', '1.5', 'abc', '100001']) {
      const res = await fetch(base + '/api/developer/generations?page=' + page, { headers: { 'x-test-user': '42' } });
      assert.equal(res.status, 400);
    }
    assert.equal(queries.length, 0);
  });
  await fixture(async base => {
    const res = await fetch(base + '/api/developer/generations', { headers: { 'x-test-user': '42' } });
    assert.equal(res.status, 503);
    assert.ok(!/flora|secret|sql/i.test(await res.text()));
  }, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiWallet, VIDEO_PRICE, MIN_TOPUP } = require('../server/api-wallet');

function fixture(balance = 100000) {
  let state = { balance, botSaldo: 70000, credits: new Set(), charges: new Map(), tasks: new Map() };
  let tail = Promise.resolve();
  async function query(sql, p = [], client = {}) {
    const s = sql.replace(/\s+/g, ' ').trim();
    const rows = value => ({ rows: value });
    if (s === 'BEGIN') {
      const before = tail;
      tail = new Promise(resolve => { client.unlock = resolve; });
      await before;
      client.snapshot = structuredClone(state);
      return rows([]);
    }
    if (s === 'COMMIT' || s === 'ROLLBACK') {
      if (s === 'ROLLBACK') state = client.snapshot;
      client.unlock(); return rows([]);
    }
    if (s.startsWith('CREATE') || s.startsWith('INSERT INTO portal_api_wallets')) return rows([]);
    if (s.startsWith('SELECT COALESCE')) return rows(p[0] === 1 ? [{ balance: state.balance,
      reserved: [...state.charges.values()].filter(c => c.status === 'held').reduce((n,c) => n+c.amount,0) }] : []);
    if (s.startsWith('SELECT balance')) return rows([{ balance: state.balance }]);
    if (s.startsWith('INSERT INTO portal_api_wallet_credits')) {
      if (state.credits.has(p[0])) return rows([]);
      state.credits.add(p[0]); return rows([{ invoice_id: p[0] }]);
    }
    if (s.startsWith('UPDATE portal_api_wallets')) {
      if (s.includes('balance -')) state.balance -= p[1];
      else {
        const held = [...state.charges.values()].filter(c => c.status === 'held').reduce((n,c) => n+c.amount,0);
        if (p[2] != null && state.balance + held > p[2]) return rows([]);
        state.balance += p[1];
      }
      return rows([{ balance: state.balance }]);
    }
    if (s.startsWith('SELECT * FROM portal_api_wallet_charges')) {
      const row = state.charges.get(p[0]); return rows(row ? [structuredClone(row)] : []);
    }
    if (s.startsWith('INSERT INTO portal_api_wallet_charges')) {
      state.charges.set(p[0], {task_id:p[0],user_id:p[1],amount:p[2],status:'held'}); return rows([]);
    }
    if (s.startsWith('UPDATE portal_api_wallet_charges')) {
      state.charges.get(p[0]).status=p[1]; return rows([]);
    }
    if (s.startsWith('SELECT * FROM video_generation_tasks')) {
      const row=state.tasks.get(p[0]);return rows(row?[structuredClone(row)]:[]);
    }
    if (s.startsWith('UPDATE video_generation_tasks')) {
      assert.equal((s.match(/\$1::text/g) || []).length, 3,
        'Repeated status parameters require consistent explicit PostgreSQL types');
      if (client.failTaskUpdate) throw new Error('simulated task update failure');
      const row=state.tasks.get(p[2]); Object.assign(row,{status:p[0],video_url:p[1]});return rows([structuredClone(row)]);
    }
    throw new Error('Unexpected wallet SQL: '+s);
  }
  const pool = {query, async connect(){const client={query:(s,p)=>query(s,p,client),release(){}};return client;}};
  const wallet=createApiWallet(pool);
  async function transaction(fn) {
    const c=await pool.connect();await c.query('BEGIN');
    try{const value=await fn(c);await c.query('COMMIT');return value;}
    catch(e){await c.query('ROLLBACK');throw e;}
  }
  async function reserve(id) {
    return transaction(async c => {
      await wallet.reserve(c,1,id);
      const row={task_id:id,user_id:1,status:'processing',retry_data:{billing:'wallet'}};
      state.tasks.set(id,row);return structuredClone(row);
    });
  }
  return {wallet,pool,transaction,reserve,get state(){return state;}};
}

test('confirmed prices and non-expiring API balance never reuse bot saldo', async () => {
  const h=fixture();await h.wallet.initialize();
  assert.equal(VIDEO_PRICE,6000);assert.equal(MIN_TOPUP,100000);
  assert.deepEqual(await h.wallet.get(1),{balance:100000,reserved:0,videoPrice:6000,
    modelPrices:{'wan-3.0-uncensored':6000,'wan-3.0':6500,'seedance-2.5':11000,'seedance-2.0':5000},
    minimumTopup:100000,maximumTopup:100000000,currency:'IDR',expires:false});
  await assert.rejects(h.wallet.get(2),e=>e.status===404);
  const row=await h.reserve('one');
  assert.equal(h.state.balance,94000);
  assert.equal((await h.wallet.get(1)).reserved,6000);
  await h.wallet.finish(row,{status:'completed',videoUrl:'/video'});
  assert.equal(h.state.balance,94000);assert.equal(h.state.botSaldo,70000);
  assert.equal((await h.wallet.get(1)).reserved,0);
});

test('each Seedance reserves its own price, refunds it once on failure, and never refunds success', async () => {
  for(const [model,price] of [['seedance-2.5',11000],['seedance-2.0',5000]]) {
  for(const status of ['failed','completed']) {
    const h=fixture(price);await h.wallet.initialize();
    const row=await h.transaction(async c=>{
      await h.wallet.reserve(c,1,'seedance',price);
      const row={task_id:'seedance',user_id:1,model,status:'processing',retry_data:{billing:'wallet',price}};
      h.state.tasks.set(row.task_id,row);return row;
    });
    assert.equal(h.state.balance,0);
    assert.equal(h.state.charges.get('seedance').amount,price);
    await h.wallet.finish(row,{status,videoUrl:status==='completed'?'/video':null});
    await h.wallet.finish(row,{status:'failed'});
    assert.equal(h.state.balance,status==='failed'?price:0);
    assert.equal(h.state.charges.get('seedance').status,status==='failed'?'refunded':'spent');
  }
  const low=fixture(price-1);await low.wallet.initialize();
  await assert.rejects(low.transaction(c=>low.wallet.reserve(c,1,'low',price)),e=>e.status===402);
  }
});

test('new Wan reservations use Rp6.500 and failures refund the original model-specific amount once', async () => {
  const h=fixture(6500);await h.wallet.initialize();
  const row=await h.transaction(async c=>{
    await h.wallet.reserve(c,1,'new-wan',6500);
    const row={task_id:'new-wan',user_id:1,model:'wan-3.0',status:'processing',retry_data:{billing:'wallet',price:6500}};
    h.state.tasks.set(row.task_id,row);
    return row;
  });
  assert.equal(h.state.balance,0);
  assert.equal(h.state.charges.get('new-wan').amount,6500);
  await h.wallet.finish(row,{status:'failed'});
  await h.wallet.finish(row,{status:'failed'});
  assert.equal(h.state.balance,6500);
  assert.equal(h.state.charges.get('new-wan').status,'refunded');
  const low=fixture(6499);await low.wallet.initialize();
  await assert.rejects(low.transaction(c=>low.wallet.reserve(c,1,'too-low',6500)),e=>e.status===402);
  await assert.rejects(low.transaction(c=>low.wallet.reserve(c,1,'wrong-price',1)),e=>e.status===503);
  assert.equal(low.state.balance,6499);
});

test('credit is idempotent, excludes unique gateway fees, and rolls back with its transaction', async () => {
  const h=fixture(0);await h.wallet.initialize();
  const invoice={id:'invoice',user_id:1,amount:100000,total_amount:100021};
  await Promise.all([h.transaction(c=>h.wallet.credit(c,invoice)),h.transaction(c=>h.wallet.credit(c,invoice))]);
  assert.equal(h.state.balance,100000);
  await assert.rejects(h.transaction(async c=>{
    await h.wallet.credit(c,{...invoice,id:'broken'});
    throw new Error('simulated invoice commit failure');
  }));
  assert.equal(h.state.balance,100000);assert.equal(h.state.credits.size,1);
});

test('concurrent reservations cannot overspend; replay does not reserve twice', async () => {
  const h=fixture(6000);await h.wallet.initialize();
  const results=await Promise.allSettled([h.reserve('a'),h.reserve('b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,402);
  assert.equal(h.state.balance,0);assert.equal(h.state.charges.size,1);
  const id=[...h.state.charges.keys()][0];
  await assert.rejects(h.reserve(id),e=>e.status===409);
  assert.equal(h.state.balance,0);
});

test('a verified failure refunds once, while uncertain processing retains the reservation', async () => {
  const h=fixture();await h.wallet.initialize();const row=await h.reserve('one');
  await h.wallet.finish(row,{status:'processing'});
  assert.equal(h.state.balance,94000);
  await Promise.all([h.wallet.finish(row,{status:'failed'}),h.wallet.finish(row,{status:'failed'})]);
  assert.equal(h.state.balance,100000);assert.equal(h.state.charges.get('one').status,'refunded');
  assert.equal((await h.wallet.finish(row,{status:'completed',videoUrl:'/late'})).status,'failed');
  assert.equal(h.state.balance,100000);
});

test('completed tasks cannot be refunded or overwritten by a late failed/pending poll', async () => {
  const h=fixture();await h.wallet.initialize();const row=await h.reserve('one');
  await h.wallet.finish(row,{status:'completed',videoUrl:'/video'});
  await h.wallet.finish(row,{status:'failed'});
  await h.wallet.finish(row,{status:'processing'});
  assert.equal(h.state.balance,94000);assert.equal(h.state.tasks.get('one').status,'completed');
  assert.equal(h.state.charges.get('one').status,'spent');
});

test('legacy task completion uses typed status SQL without creating a wallet charge', async () => {
  const h=fixture();await h.wallet.initialize();
  const row={task_id:'legacy',user_id:1,status:'processing',retry_data:{billing:'legacy'}};
  h.state.tasks.set(row.task_id,row);
  const completed=await h.wallet.finish(row,{status:'completed',videoUrl:'/video'});
  assert.equal(completed.status,'completed');
  assert.equal(h.state.balance,100000);
  assert.equal(h.state.charges.size,0);
});

test('failed task persistence rolls refund and task state back together', async () => {
  const h=fixture();await h.wallet.initialize();const row=await h.reserve('one');
  const client=await h.pool.connect();client.failTaskUpdate=true;
  await assert.rejects(h.wallet.finish(row,{status:'failed'},client));
  assert.equal(h.state.balance,94000);assert.equal(h.state.charges.get('one').status,'held');
  assert.equal(h.state.tasks.get('one').status,'processing');
});

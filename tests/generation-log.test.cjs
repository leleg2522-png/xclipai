const test=require('node:test');
const assert=require('node:assert/strict');
const {createGenerationLogger,describeError}=require('../server/generation-log');

test('log records allow only safe fields and never stringify raw errors or credentials',()=>{
  const records=[],logger=createGenerationLogger({write:(_level,record)=>records.push(record)});
  logger.error('task_poll_failed',{
    taskId:'xv_'+'a'.repeat(64),stage:'persist_task_status',...describeError({
      code:'42P08',message:'secret password',detail:'signed URL',stack:'raw stack',
      config:{headers:{Authorization:'Bearer fake_secret'}}
    }),prompt:'private prompt',apiKey:'fake_secret',error:{message:'private secret'},
    url:'https://private.example/?signature=hidden',runId:'run_private',userId:42,email:'private@example.com',
    progress:Infinity});
  assert.equal(records[0].code,'42P08');
  assert.equal(records[0].message,'Tipe parameter SQL tidak konsisten.');
  assert.ok(!/password|signature|private|fake_secret|Authorization|stack/i.test(JSON.stringify(records)));
  assert.equal(records[0].progress,undefined);
  logger.info('worker_heartbeat',{checkedTasks:0,failedChecks:0,elapsedMs:2});
  assert.equal(records[1].checkedTasks,0);
  assert.equal(describeError({code:'TOKEN'}).code,undefined);
});

test('a logging sink failure cannot break generation or financial state',()=>{
  const logger=createGenerationLogger({write:()=>{throw new Error('logging unavailable');}});
  assert.doesNotThrow(()=>logger.error('task_failed',{reason:'upstream_generation_failed'}));
  assert.doesNotThrow(()=>logger.info('task_completed',{status:'completed'}));
});

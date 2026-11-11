import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';

const BASE='https://ops-staging.finnbilglass.no';
function setup({pauseStatusReads=false,failHistory=false}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec("CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY,status TEXT NOT NULL,updated_at INTEGER,assigned_to TEXT)");
  sqlite.exec("INSERT INTO beta_inquiries VALUES(1,'OFFERED',0,'operator')");
  sqlite.exec("CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY,inquiry_id INTEGER REFERENCES beta_inquiries(id),event_type TEXT,previous_status TEXT,status TEXT,note TEXT,created_at INTEGER,created_by TEXT,meta_json TEXT)");
  if(failHistory)sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON beta_inquiry_events BEGIN SELECT RAISE(ABORT,'HISTORY_FAILURE_INJECTED'); END");
  let reads=0,release;
  const gate=new Promise(resolve=>release=resolve);
  function prep(sql,args=[]){
    return {
      sql,args,bind(...newArgs){return prep(sql,newArgs)},
      async first(){
        const row=sqlite.prepare(sql).get(...args)??null;
        if(pauseStatusReads&&sql.includes('SELECT status FROM beta_inquiries WHERE id = ?')){
          reads++;if(reads>=2)release();
          await gate;
        }
        return row;
      },
      async all(){return {results:sqlite.prepare(sql).all(...args)}},
      async run(){
        const r=sqlite.prepare(sql).run(...args);
        return {meta:{changes:Number(r.changes)}};
      }
    };
  }
  const env={
    ENVIRONMENT:'staging',
    OPS_STAFF_PORTAL_ENABLED:'false',
    SUPPORT_EVIDENCE_TOKEN:'synthetic-support-token',
    FINNBILGLASS_DB:{
      prepare(sql){return prep(sql)},
      async batch(stmts){
        sqlite.exec('BEGIN IMMEDIATE');
        try{
          const results=stmts.map(stmt=>{
            const r=sqlite.prepare(stmt.sql).run(...stmt.args);
            return {meta:{changes:Number(r.changes)}};
          });
          sqlite.exec('COMMIT');
          return results;
        }catch(err){sqlite.exec('ROLLBACK');throw err}
      }
    }
  };
  function req(status){
    return new Request(BASE+'/api/ops/inquiries/1/status',{
      method:'POST',
      headers:{
        Authorization:'Bearer synthetic-support-token',
        Origin:BASE,'Content-Type':'application/json','X-FBG-Manual-Intent':'1'
      },
      body:JSON.stringify({status,actor:'Synthetic Operator',
        reason:'Test of competing status transitions'})
    });
  }
  return {sqlite,env,req,close(){sqlite.close()}};
}

test('two concurrent status transitions yield exactly one winner and one history row',async()=>{
  const f=setup({pauseStatusReads:true});
  try{
    const [r1,r2]=await Promise.all([
      worker.fetch(f.req('CONFIRMED'),f.env),
      worker.fetch(f.req('CLOSED'),f.env)
    ]);
    assert.deepEqual([r1.status,r2.status].sort((a,b)=>a-b),[200,409]);
    const row=f.sqlite.prepare('SELECT status FROM beta_inquiries WHERE id=1').get();
    const history=f.sqlite.prepare('SELECT previous_status,status FROM beta_inquiry_events').all();
    assert.equal(history.length,1);
    assert.equal(history[0].previous_status,'OFFERED');
    assert.equal(history[0].status,row.status);
    assert.ok(['CONFIRMED','CLOSED'].includes(row.status));
  }finally{f.close()}
});
test('failed history INSERT rolls the status transition back',async()=>{
  const f=setup({failHistory:true});
  try{
    const response=await worker.fetch(f.req('CONFIRMED'),f.env);
    assert.equal(response.status,503);
    assert.equal(f.sqlite.prepare('SELECT status FROM beta_inquiries WHERE id=1').get().status,'OFFERED');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM beta_inquiry_events').get().n,0);
  }finally{f.close()}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  inviteOpsStaff,recogniseInvitedStaff,revokeOpsStaff,listOpsStaff,listOpsActivity,appendOpsAudit
} from '../src/ops-staff.ts';

const schema=readFileSync(new URL('../migrations/proposed/0041_ops_staff_invites_activity.sql.proposed',import.meta.url),'utf8');
const admin={email:'admin@example.com',subject:'admin-session',audience:'ops-aud',role:'ADMIN',status:'ACTIVE'};
const worker={email:'worker@example.com',subject:'google-session',audience:'ops-aud'};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(schema);
 sqlite.prepare("INSERT INTO ops_staff_memberships(email,role,status,invited_by,invited_at,accepted_at) VALUES (?,?,'ACTIVE',?,1000,1000)")
   .run(admin.email,admin.role,'bootstrap');
 function make(sql,args=[]){
   return {
     bind(...values){return make(sql,values)},
     async first(){return sqlite.prepare(sql).get(...args)??null},
     async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},
     async all(){return {results:sqlite.prepare(sql).all(...args)}}
   };
 }
 return {sqlite,db:{prepare(sql){return make(sql)}}};
}
test('one-click invite + first Access login activates role, no app OTP or per-user env entry',async()=>{
 const f=fixture();
 try{
  const invite=await inviteOpsStaff(f.db,admin,'Worker@Example.com','OPERATOR',2000);
  assert.deepEqual(invite,{email:'worker@example.com',role:'OPERATOR',status:'INVITED'});
  assert.equal(await recogniseInvitedStaff(f.db,worker,'signed.cloud.jwt.1',2200),Object.assign({},worker,{role:'OPERATOR',status:'ACTIVE'}));
  const same=await recogniseInvitedStaff(f.db,worker,'signed.cloud.jwt.1',2300);
  assert.equal(same?.role,'OPERATOR');
  const logs=await listOpsActivity(f.db,admin);
  assert.deepEqual(logs.map(x=>x.action).sort(),['LOGIN','STAFF_INVITED']);
  const employees=await listOpsStaff(f.db,admin);
  assert.equal(employees.length,2);
  assert.equal(employees.find(x=>x.email===worker.email)?.status,'ACTIVE');
  assert.equal(employees.find(x=>x.email===worker.email)?.last_login_at,2300);
  await recogniseInvitedStaff(f.db,worker,'new.signed.cloud.jwt.2',2500);
  const again=await listOpsActivity(f.db,admin);
  assert.equal(again.filter(x=>x.action==='LOGIN').length,2,'new signed token is another login session');
 }finally{f.sqlite.close();}
});
test('uninvited or revoked Google user has no staff access',async()=>{
 const f=fixture();
 try{
  assert.equal(await recogniseInvitedStaff(f.db,worker,'jwt.first',1500),null);
  await inviteOpsStaff(f.db,admin,'worker@example.com','REVIEWER',2000);
  await recogniseInvitedStaff(f.db,worker,'jwt.second',2200);
  assert.equal(await revokeOpsStaff(f.db,admin,worker.email,2400),true);
  assert.equal(await recogniseInvitedStaff(f.db,worker,'jwt.third',2600),null);
  assert.equal((await listOpsActivity(f.db,admin)).filter(x=>x.action==='STAFF_REVOKED').length,1);
 }finally{f.sqlite.close();}
});
test('non-admin cannot invite staff, see activity or revoke someone',async()=>{
 const f=fixture();
 const regular={...admin,role:'OPERATOR'};
 try{
  await assert.rejects(inviteOpsStaff(f.db,regular,'new@example.com','ADMIN',2000),/OPS_STAFF_ADMIN_REQUIRED/);
  await assert.rejects(listOpsActivity(f.db,regular),/OPS_STAFF_ADMIN_REQUIRED/);
  await assert.rejects(listOpsStaff(f.db,regular),/OPS_STAFF_ADMIN_REQUIRED/);
  await assert.rejects(revokeOpsStaff(f.db,regular,'worker@example.com',2000),/OPS_STAFF_ADMIN_REQUIRED/);
  await assert.rejects(revokeOpsStaff(f.db,admin,admin.email,2000),/OPS_STAFF_CANNOT_REVOKE_SELF/);
 }finally{f.sqlite.close();}
});
test('append-only activity cannot be altered or deleted, and no bearer tokens are stored',async()=>{
 const f=fixture();
 try{
  await appendOpsAudit(f.db,admin.email,'ORDER_CREATED','ORDER','ORDER-123456',2000,'evt_100');
  assert.throws(()=>f.sqlite.prepare("UPDATE ops_staff_activity SET actor_email='intruder@example.com'").run(),
    /AUDIT_LOG_IMMUTABLE/);
  assert.throws(()=>f.sqlite.prepare("DELETE FROM ops_staff_activity").run(),/AUDIT_LOG_IMMUTABLE/);
  const logs=await listOpsActivity(f.db,admin,500);
  assert.equal(logs.length,1);
  assert.equal(logs[0].actor_email,admin.email);
  assert.doesNotMatch(JSON.stringify(logs),/signed\.cloud\.jwt/i);
 }finally{f.sqlite.close();}
});

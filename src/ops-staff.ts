/** Minimal staff invitation and audit registry for FinnBilGlass Operations Centre.
 * One login: Cloudflare Access Google / email OTP. No additional app passwords,
 * passwords-in-email, per-staff env allowlists, or Kustom interactions.
 */
import type { VerifiedStaff } from './ops-manual-access';

export type OpsRole='ADMIN'|'OPERATOR'|'REVIEWER';
export type OpsStaff=VerifiedStaff & {role:OpsRole,status:'ACTIVE'};
interface Membership {
  email:string;role:OpsRole;status:'INVITED'|'ACTIVE'|'REVOKED';
  invited_by:string;invited_at:number;accepted_at:number|null;
  last_login_at:number|null;revoked_at:number|null;
}
export interface AuditItem {
  event_id:string;actor_email:string;action:string;subject_type:string;
  subject_id:string;created_at:number;details_json:string;
}
const pattern=/^[^\s@]{1,80}@[^\s@]{1,200}\.[^\s@]{2,30}$/;
const roles=['ADMIN','OPERATOR','REVIEWER'] as const;

function normalized(email:string):string{
  const v=email.trim().toLowerCase();
  if(!pattern.test(v) || v.length>254)throw new Error('OPS_STAFF_INVALID_EMAIL');
  return v;
}

/** Creates no role automatically: staff must have an explicit invitation in D1.
 * First verified Access visit activates invite and logs a login without a second step.
 */
export async function recogniseInvitedStaff(
  db:D1Database, verified:VerifiedStaff, accessToken:string, now=Date.now()
):Promise<OpsStaff|null>{
  const email=normalized(verified.email);
  const row=await db.prepare(
    'SELECT email,role,status,invited_by,invited_at,accepted_at,last_login_at,revoked_at '+
    'FROM ops_staff_memberships WHERE email=?'
  ).bind(email).first<Membership>();
  if(!row || row.status==='REVOKED' || !roles.includes(row.role))return null;
  if(row.status==='INVITED'){
    await db.prepare(
      "UPDATE ops_staff_memberships SET status='ACTIVE',accepted_at=?,last_login_at=? "+
      "WHERE email=? AND status='INVITED'"
    ).bind(now,now,email).run();
  }
  // Hash signed token. Never persist the bearer token itself or the staff IP.
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(accessToken));
  const fingerprint=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const eventId='login-'+fingerprint;
  await db.prepare(
    "INSERT OR IGNORE INTO ops_staff_activity "+
    "(event_id,actor_email,action,subject_type,subject_id,created_at,details_json) "+
    "VALUES(?,?,'LOGIN','STAFF',?,?,'{}')"
  ).bind(eventId,email,email,now).run();
  await db.prepare(
    'UPDATE ops_staff_memberships SET last_login_at=? WHERE email=? AND status=\'ACTIVE\' '+
    'AND (last_login_at IS NULL OR last_login_at<?)'
  ).bind(now,email,now).run();
  return {email,role:row.role,status:'ACTIVE',subject:verified.subject,audience:verified.audience};
}

/** Audit only human-approved actions; never store raw email content or access tokens. */
export async function appendOpsAudit(
  db:D1Database,actorEmail:string,action:AuditItem['action'],subjectType:string,
  subjectId:string,now=Date.now(),eventId=crypto.randomUUID()
):Promise<void>{
  const actor=normalized(actorEmail);
  if(!['STAFF','OFFER','ORDER','INQUIRY'].includes(subjectType) ||
     !/^[a-zA-Z0-9@._:-]{1,128}$/.test(subjectId) ||
     !/^[A-Z_]{3,40}$/.test(action))throw new Error('OPS_AUDIT_INVALID_EVENT');
  await db.prepare(
    'INSERT INTO ops_staff_activity (event_id,actor_email,action,subject_type,subject_id,created_at) '+
    'VALUES(?,?,?,?,?,?)'
  ).bind(eventId,actor,action,subjectType,subjectId,now).run();
}

/** Used by the invite button; permission is enforced on the server, not the browser. */
export async function inviteOpsStaff(
  db:D1Database,actor:OpsStaff, emailInput:string,roleInput:OpsRole,now=Date.now()
):Promise<{email:string,role:OpsRole,status:'INVITED'|'ACTIVE'}>{
  if(actor.role!=='ADMIN'||actor.status!=='ACTIVE')throw new Error('OPS_STAFF_ADMIN_REQUIRED');
  const email=normalized(emailInput);
  if(!roles.includes(roleInput))throw new Error('OPS_STAFF_INVALID_ROLE');
  const prior=await db.prepare('SELECT role,status FROM ops_staff_memberships WHERE email=?')
    .bind(email).first<Pick<Membership,'role'|'status'>>();
  if(prior?.status==='ACTIVE')throw new Error('OPS_STAFF_ALREADY_ACTIVE');
  await db.prepare(
    'INSERT INTO ops_staff_memberships(email,role,status,invited_by,invited_at) '+
    "VALUES(?,?,'INVITED',?,?) ON CONFLICT(email) DO UPDATE SET "+
    "role=excluded.role,status='INVITED',invited_by=excluded.invited_by,"+
    "invited_at=excluded.invited_at,accepted_at=NULL,last_login_at=NULL,revoked_at=NULL "+
    "WHERE status IN ('INVITED','REVOKED')"
  ).bind(email,roleInput,actor.email,now).run();
  await appendOpsAudit(db,actor.email,'STAFF_INVITED','STAFF',email,now);
  return {email,role:roleInput,status:'INVITED'};
}

/** Never delete activity on staff revocation. */
export async function revokeOpsStaff(
  db:D1Database,actor:OpsStaff,emailInput:string,now=Date.now()
):Promise<boolean>{
  if(actor.role!=='ADMIN'||actor.status!=='ACTIVE')throw new Error('OPS_STAFF_ADMIN_REQUIRED');
  const email=normalized(emailInput);
  if(email===actor.email)throw new Error('OPS_STAFF_CANNOT_REVOKE_SELF');
  const r=await db.prepare(
    "UPDATE ops_staff_memberships SET status='REVOKED',revoked_at=? "+
    "WHERE email=? AND status IN ('ACTIVE','INVITED')"
  ).bind(now,email).run();
  if(Number(r.meta.changes??0)===1){
    await appendOpsAudit(db,actor.email,'STAFF_REVOKED','STAFF',email,now);
    return true;
  }
  return false;
}

/** Admin-only activity viewer, with bounded queries and server-side pagination. */
export async function listOpsActivity(
  db:D1Database,actor:OpsStaff,limit=50,before?:number
):Promise<AuditItem[]>{
  if(actor.role!=='ADMIN')throw new Error('OPS_STAFF_ADMIN_REQUIRED');
  const cap=Math.max(1,Math.min(100,Math.floor(limit)));
  const result=before&&Number.isSafeInteger(before)?
    await db.prepare(
      'SELECT event_id,actor_email,action,subject_type,subject_id,created_at,details_json '+
      'FROM ops_staff_activity WHERE created_at<? ORDER BY created_at DESC,event_id DESC LIMIT ?'
    ).bind(before,cap).all<AuditItem>():
    await db.prepare(
      'SELECT event_id,actor_email,action,subject_type,subject_id,created_at,details_json '+
      'FROM ops_staff_activity ORDER BY created_at DESC,event_id DESC LIMIT ?'
    ).bind(cap).all<AuditItem>();
  return result.results??[];
}

export async function listOpsStaff(db:D1Database,actor:OpsStaff):Promise<Membership[]>{
  if(actor.role!=='ADMIN')throw new Error('OPS_STAFF_ADMIN_REQUIRED');
  const r=await db.prepare(
    'SELECT email,role,status,invited_by,invited_at,accepted_at,last_login_at,revoked_at '+
    'FROM ops_staff_memberships ORDER BY invited_at DESC LIMIT 200'
  ).all<Membership>();
  return r.results??[];
}

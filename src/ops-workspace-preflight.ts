/** Admin-only, staging-only Gmail capability preflight.
 * Uses the existing encrypted Workspace refresh grant to fetch ONLY Gmail's
 * users/me/profile. Never lists, reads, stores, sends or imports email messages.
 * Requires the usual signed Cloudflare Access JWT, D1 ADMIN and same-origin POST
 * at the routing layer. No token or provider response is returned to the UI.
 */
import type { Env } from './types';
import { expectedWorkspaceMailbox, workspaceConnectionStatus } from './ops-workspace-oauth';
import { getGmailTokens, gmailApiFetch } from './ops-workbench/gmail-sync';

type PreflightReason =
  | 'NOT_CONNECTED' | 'TOKEN_REFRESH_FAILED' | 'PROFILE_UNAVAILABLE'
  | 'WRONG_MAILBOX' | 'ALIAS_NOT_CONFIGURED' | 'PROFILE_VERIFIED';

export interface WorkspaceGmailPreflight {
  ok: boolean;
  reason: PreflightReason;
  mailboxVerified: boolean;
  aliasConfigured: boolean;
  importEnabled: boolean;
}

function preflightResult(
  env: Env, reason: PreflightReason, mailboxVerified: boolean, aliasConfigured: boolean
): WorkspaceGmailPreflight {
  return {ok: reason==='PROFILE_VERIFIED', reason, mailboxVerified,
    aliasConfigured, importEnabled: env.GMAIL_SYNC_ENABLED==='true'};
}

function allowedInboundAddress(env: Env): boolean {
  const raw=(env.OPS_INBOUND_ADDRESS||'').trim().toLowerCase();
  // Configuration presence is NOT proof of an active MX or verified alias.
  return /^[a-z0-9._%+-]+@finnbilglass\.no$/.test(raw);
}

export async function checkWorkspaceGmailPreflight(env: Env): Promise<WorkspaceGmailPreflight> {
  const aliasConfigured=allowedInboundAddress(env);
  const expected=expectedWorkspaceMailbox(env);
  if(env.ENVIRONMENT!=='staging' || env.OPS_WORKSPACE_OAUTH_ENABLED!=='true' || !expected) {
    return preflightResult(env,'NOT_CONNECTED',false,aliasConfigured);
  }
  const grant=await workspaceConnectionStatus(env);
  if(!grant.connected || grant.mailbox!==expected){
    return preflightResult(env,'NOT_CONNECTED',false,aliasConfigured);
  }
  let token:string;
  try {
    const refresh=await getGmailTokens(env);
    if(!refresh?.access_token){
      return preflightResult(env,'TOKEN_REFRESH_FAILED',false,aliasConfigured);
    }
    token=refresh.access_token;
  } catch {
    return preflightResult(env,'TOKEN_REFRESH_FAILED',false,aliasConfigured);
  }
  try {
    const response=await gmailApiFetch(token,'/users/me/profile',{
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)return preflightResult(env,'PROFILE_UNAVAILABLE',false,aliasConfigured);
    const profile=await response.json() as {emailAddress?:unknown};
    if(typeof profile.emailAddress!=='string' ||
       profile.emailAddress.trim().toLowerCase()!==expected) {
      return preflightResult(env,'WRONG_MAILBOX',false,aliasConfigured);
    }
    return preflightResult(env,
      aliasConfigured?'PROFILE_VERIFIED':'ALIAS_NOT_CONFIGURED',true,aliasConfigured);
  } catch {
    return preflightResult(env,'PROFILE_UNAVAILABLE',false,aliasConfigured);
  }
}

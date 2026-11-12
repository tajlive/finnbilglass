import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yml = readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
const job = yml.split('\n  deploy:\n')[1]?.split('\n  smoke-betatest:\n')[0];

test('prod release requires dispatch, pinned main SHA and protected GitHub production environment',()=>{
  assert.ok(job,'deployment job exists');
  assert.match(job,/if: github\.event_name == 'workflow_dispatch' && inputs\.authorization == 'PRODUCTION-GO'/);
  assert.match(job,/environment: production/);
  assert.match(job,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(job,/git rev-parse HEAD/);
  assert.match(job,/APPROVED_SHA/);
});

test('no hidden Worker deploy when preparing secrets; preflight is read-only and checks all required names',()=>{
  assert.doesNotMatch(job,/\bwrangler\s+(?:versions\s+)?secret\s+(?:put|delete|bulk)\b/);
  assert.match(job,/wrangler secret list --name finnbilglass-frontrute --format json/);
  for (const name of ['SVV_API_KEY','RESEND_API_KEY','OPS_ACCESS_AUD','OPS_STAFF_PORTAL_ENABLED','OPS_MANUAL_ORDERS_ENABLED','GMAIL_SYNC_ENABLED','OPS_WORKSPACE_OAUTH_ENABLED','ac35018c-0d43-4742-adf8-d881b7274684']) {
    assert.ok(job.includes(name),name+' required by prod release preflight');
  }
});

test('all production writes are in manual gated deploy job, not on push',()=>{
  assert.match(yml,/on:\n  push:\n    branches: \[main\]/);
  const beforeDeploy=yml.split('\n  deploy:\n')[0];
  assert.doesNotMatch(beforeDeploy,/\bwrangler\s+(?:deploy|secret put|d1 execute)\b/);
  assert.match(job,/npx wrangler deploy/);
  assert.doesNotMatch(job,/\bwrangler\s+d1\s+execute\b/);
});

test('production Access AUD can be provided atomically with code without separate secret deployment',()=>{
  assert.match(job,/OPS_ACCESS_AUD: \$\{\{ secrets\.OPS_ACCESS_AUD \}\}/);
  assert.match(job,/wrangler deploy --secrets-file "\$RUNNER_TEMP\/fbg-access-secret\.json"/);
  assert.match(job,/REQUIRED_PRODUCTION_ACCESS_AUD_NOT_CONFIGURED/);
  assert.match(job,/trap 'rm -f "\$RUNNER_TEMP\/fbg-access-secret\.json"' EXIT/);
  assert.doesNotMatch(job,/\bwrangler\s+versions\s+secret\s+put\b/);
});

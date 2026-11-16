import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('independent Cloudflare readiness is manual, pinned and has no production writes',()=>{
  const yml=readFileSync(new URL('../.github/workflows/ops-production-readiness.yml',import.meta.url),'utf8');
  assert.match(yml,/on:\n  workflow_dispatch:/);
  assert.doesNotMatch(yml,/\bon:\n  push:/);
  assert.match(yml,/permissions:\n  contents: read/);
  assert.match(yml,/github\.ref == 'refs\/heads\/main'/);
  assert.match(yml,/PREFLIGHT-ONLY/);
  assert.match(yml,/environment: production/);
  assert.match(yml,/git rev-parse HEAD/);
  assert.match(yml,/cloudflare-ops-preflight\.mjs/);
  assert.match(yml,/wrangler secret list --name finnbilglass-frontrute --format json/);
  assert.doesNotMatch(yml,/\bwrangler\s+(?:deploy|d1\s+execute|(?:versions\s+)?secret\s+(?:put|delete|bulk)|rollback)\b/);
  assert.doesNotMatch(yml,/\b(?:curl|wget)\s+.*--request\s+(?:POST|PUT|PATCH|DELETE)/);
});

test('read-only Cloudflare script never issues API write or logs raw secrets',()=>{
  const source=readFileSync(new URL('../scripts/maintenance/cloudflare-ops-preflight.mjs',import.meta.url),'utf8');
  assert.match(source,/method:'GET'/);
  assert.doesNotMatch(source,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(source,/console\.(?:log|error)\([^)]*(?:Authorization|Bearer|token\b|aud\b)/);
  assert.match(source,/CLOUDFLARE_PAGINATION_NOT_EXHAUSTIVE/);
  assert.match(source,/COMPETING_ACCESS_APP_ON_PROTECTED_OPS_PATH/);
  assert.match(source,/OPS_PATH_INTERCEPTED_BY_OTHER_WORKER_ROUTE/);
  assert.match(source,/WORKER_CUSTOM_DOMAIN_WRONG_SERVICE_OR_ENVIRONMENT/);
});

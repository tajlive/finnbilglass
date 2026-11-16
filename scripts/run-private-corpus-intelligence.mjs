#!/usr/bin/env node
/** Single-command offline pipeline. Private local inputs only; never deploy. */
import { mkdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2),inputs=[];
let outputDir=null,frozenSample=null;
for(let i=0;i<args.length;i++){
  if(args[i]==='--input'&&args[i+1])inputs.push(resolve(args[++i]));
  else if(args[i]==='--output-dir'&&args[i+1])outputDir=resolve(args[++i]);
  else if(args[i]==='--frozen-sample'&&args[i+1])frozenSample=resolve(args[++i]);
  else throw Error('USAGE: --input PRIVATE.jsonl [--input SECOND.ndjson] --output-dir PRIVATE_DIRECTORY [--frozen-sample EXISTING_PRIVATE_30.json]');
}
if(!inputs.length||!outputDir)throw Error('INPUTS_AND_PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
const key=process.env.FBG_CORPUS_HMAC_KEY;
if(!key||Buffer.byteLength(key,'utf8')<32)throw Error('STRONG_HMAC_KEY_REQUIRED');
mkdirSync(outputDir,{recursive:true,mode:0o700});
if((statSync(outputDir).mode&0o077)!==0)throw Error('OUTPUT_DIRECTORY_MUST_BE_PRIVATE_0700');
const outputs={
  audit:join(outputDir,'audit-aggregates.json'),
  queue:join(outputDir,'queue-all-vehicles.json'),
  sample:join(outputDir,'frozen-first30.json'),
  fitment:join(outputDir,'fitment-aggregates.json'),
  enriched:join(outputDir,'priority-evidence-queue.json'),
};
function run(argv){
  const r=spawnSync(process.execPath,argv,{cwd:root,env:process.env,
    encoding:'utf8',maxBuffer:4*1024*1024});
  if(r.error||r.status!==0)throw Error('PRIVATE_CORPUS_STAGE_FAILED: inspect private environment (no paths or identifiers logged)');
  return r.stdout;
}
const a=[];
for(const path of inputs)a.push('--input',path);
run([join(root,'scripts/private-vehicle-corpus-audit.mjs'),...a,
  '--report',outputs.audit,'--queue',outputs.queue,...(frozenSample?[]:['--sample',outputs.sample])]);
run(['--import','tsx',join(root,'scripts/private-vehicle-fitment-intelligence.mjs'),
  '--queue',outputs.queue,'--sample',frozenSample??outputs.sample,
  '--report',outputs.fitment,'--enriched-queue',outputs.enriched]);
const audit=JSON.parse(readFileSync(outputs.audit,'utf8'));
const fitment=JSON.parse(readFileSync(outputs.fitment,'utf8'));
if(audit.metrics.uniqueVehicles!==fitment.totals.eligibleVehicles)
  throw Error('CORPUS_STAGE_ACCOUNTING_MISMATCH');
console.log('FBG_CORPUS_PIPELINE='+JSON.stringify({
  sourceFiles:inputs.length,eligibleVehicles:fitment.totals.eligibleVehicles,
  queueEntries:audit.processing.queuedVehicles,withCandidates:fitment.totals.withCandidates,
  withoutCandidates:fitment.totals.withoutCandidates,
  identityConflicts:fitment.totals.identityConflicts,
  frozenSample:fitment.cohort.frozenSample,holdout:fitment.cohort.holdout,
  independentOEProof:0,automaticExact:0,catalogueSha256:fitment.catalogue.sha256,
  mode:'OFFLINE_RESEARCH_ONLY',
}));

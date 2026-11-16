#!/usr/bin/env node
/** Compare two PRIVATE full-fleet evidence queues. All output is aggregate only.
 * Same FBG_CORPUS_HMAC_KEY must have been used in both runs.
 * Never outputs case IDs, REG/VIN, raw source records or individual Eurocodes.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(['--before','--after'].includes(args[i])&&args[i+1])options[args[i].slice(2)]=resolve(args[++i]);
  else throw Error('USAGE: --before PRIVATE_QUEUE.json --after NEW_PRIVATE_QUEUE.json');
}
if(!options.before||!options.after||options.before===options.after)throw Error('DISTINCT_PRIVATE_QUEUES_REQUIRED');
const load=(path)=>{
  const src=JSON.parse(readFileSync(path,'utf8'));
  if(src.purpose!=='FULL_FLEET_FITMENT_EVIDENCE_GAPS'||!Array.isArray(src.cases))
    throw Error('PRIVATE_QUEUE_FORMAT_REQUIRED');
  const m=new Map();
  for(const c of src.cases){
    if(!/^v_[a-f0-9]{32}$/.test(c.caseId)||m.has(c.caseId))
      throw Error('INVALID_OR_DUPLICATED_PSEUDONYM');
    if(!Number.isInteger(c.candidateCount)||c.candidateCount<0 ||
       c.evidenceStatus!=='NOT_VERIFIED'||c.autoExact!==false||c.confirmedGlass!==null)
      throw Error('CORPUS_EVIDENCE_GATE_VIOLATED');
    m.set(c.caseId,c);
  }
  return {cases:m,catalogueSha256:src.catalogueSha256};
};
const before=load(options.before),after=load(options.after);
const stableFingerprint=(items)=>{
  const h=createHash('sha256');
  for(const id of [...items.keys()].sort())h.update(id+';');
  return h.digest('hex');
};
if(stableFingerprint(before.cases)!==stableFingerprint(after.cases))
  throw Error('COHORT_CHANGED_COMPARE_NOT_VALID');
// Only fixed, source-reviewed model labels may appear in aggregate console
// output. Arbitrary private 'model' values may otherwise contain identifiers.
const SAFE_FAMILY_LABELS=new Set([
  'SKODA OCTAVIA','SKODA SUPERB','MITSUBISHI OUTLANDER',
  'VOLVO XC40','VOLVO C40','FORD FOCUS','FORD KUGA','FORD MONDEO',
  'TOYOTA AVENSIS','TOYOTA AURIS','TOYOTA YARIS',
]);
const safeLabel=c=>SAFE_FAMILY_LABELS.has(c.make+' '+c.model)?c.make+' '+c.model:'OTHER';
let beforeHits=0,afterHits=0,gained=0,lost=0,continuedMultiple=0,
  newlyMultiple=0,normalized=0;
const newlyCoveredFamilies=new Map(),lostFamilies=new Map();
for(const [id,b] of before.cases){
  const a=after.cases.get(id);
  if(!a)throw Error('COHORT_CHANGED_COMPARE_NOT_VALID');
  const prev=b.candidateCount>0,next=a.candidateCount>0;
  beforeHits+=prev?1:0;afterHits+=next?1:0;
  if(!prev&&next){
    gained++;
    const family=safeLabel(a);
    newlyCoveredFamilies.set(family,(newlyCoveredFamilies.get(family)??0)+1);
  }
  if(prev&&!next){
    lost++;
    const family=safeLabel(b);
    lostFamilies.set(family,(lostFamilies.get(family)??0)+1);
  }
  continuedMultiple+=b.candidateCount>1&&a.candidateCount>1?1:0;
  newlyMultiple+=b.candidateCount<=1&&a.candidateCount>1?1:0;
  normalized+=a.modelNameNormalized===true?1:0;
}
const top=m=>[...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,15)
  .filter(([,count])=>count>=5)
  .map(([family,count])=>({family,count}));
console.log('FBG_CANDIDATE_COMPARISON='+JSON.stringify({
  mode:'OFFLINE_PRIVATE_AGGREGATES_ONLY',cohortVehicles:before.cases.size,
  samePseudonymousCohort:true,
  catalogueUnchanged:before.catalogueSha256===after.catalogueSha256,
  beforeWithCandidates:beforeHits,afterWithCandidates:afterHits,
  beforeCoveragePercent:Number((100*beforeHits/before.cases.size||0).toFixed(2)),
  afterCoveragePercent:Number((100*afterHits/after.cases.size||0).toFixed(2)),
  candidateGain:gained,candidateLoss:lost,netChange:gained-lost,
  newlyMultipleCandidates:newlyMultiple,continuedMultipleCandidates:continuedMultiple,
  normalizedVehicleModelNames:normalized,
  topNewlyCoveredFamilies:top(newlyCoveredFamilies),
  topFamiliesLosingCandidates:top(lostFamilies),
  independentOEProof:0,automaticExact:0,
  caveat:'Candidate matching only; these are NOT measured correct-glass results.'
}));

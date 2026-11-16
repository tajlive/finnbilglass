#!/usr/bin/env node
/** Offline research only. Actual Class D catalog + generation registry over EVERY
 * HMAC-pseudonymized vehicle. No REG/VIN, network, Glavista, EXACT or payments. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ApplicationResolver } from '../src/fitment-v1/application-resolver.js';
import { buildDefaultGenerationRegistry } from '../src/fitment-v1/generation-registry.js';
import { FAMILIER, buildClassDCandidates, matchClassDCandidates } from '../src/fitment-v1/catalogue-candidates.js';
import { parseEurocodePosition } from '../src/fitment-v1/normalization/eurocode-position.js';
import { canonicalVehicleName } from '../src/fitment-v1/normalization/vehicle-model-name.js';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2),opt={};
for(let i=0;i<args.length;i++){
  const k=args[i];
  if(!['--queue','--sample','--report','--enriched-queue'].includes(k)||!args[i+1])
    throw Error('USAGE: --queue PRIVATE.json --report PRIVATE.json --enriched-queue PRIVATE.json [--sample FIRST30.json]');
  opt[k.slice(2)]=args[++i];
}
if(!opt.queue||!opt.report||!opt['enriched-queue'])throw Error('QUEUE_AND_PRIVATE_OUTPUTS_REQUIRED');
const paths=[resolve(opt.queue),resolve(opt.report),resolve(opt['enriched-queue']),...(opt.sample?[resolve(opt.sample)]:[])];
if(new Set(paths).size!==paths.length)throw Error('DISTINCT_FILE_PATHS_REQUIRED');
const source=JSON.parse(readFileSync(paths[0],'utf8'));
if(source.purpose!=='ALL_VEHICLES_PENDING_INDEPENDENT_EVIDENCE'||!Array.isArray(source.cases))
  throw Error('INVALID_PSEUDONYMIZED_QUEUE');
const ids=new Set();
for(const v of source.cases){
  if(!/^v_[a-f0-9]{32}$/.test(v.caseId)||ids.has(v.caseId))throw Error('INVALID_OR_DUPLICATE_CASE_ID');
  ids.add(v.caseId);
  if(typeof v.make!=='string'||typeof v.model!=='string'||!Number.isInteger(v.year))
    throw Error('MISSING_VEHICLE_FACTS');
  if(v.evidenceStatus!=='NOT_VERIFIED'||v.confirmedGlass!==null)
    throw Error('INDEPENDENT_EVIDENCE_CANNOT_BE_RESET');
}
let sample=null;
if(opt.sample){
  const src=JSON.parse(readFileSync(resolve(opt.sample),'utf8'));
  if(!Array.isArray(src.cases)||src.cases.length>30)throw Error('INVALID_FROZEN_SAMPLE');
  const testIds=new Set();
  for(const c of src.cases){
    if(!ids.has(c.caseId)||testIds.has(c.caseId)||!['DEVELOPMENT','HOLDOUT'].includes(c.split))
      throw Error('FROZEN_SAMPLE_ID_OR_SPLIT_MISMATCH');
    testIds.add(c.caseId);
  }
  sample=new Map(src.cases.map(c=>[c.caseId,c.split]));
}
const catalogueHash=createHash('sha256');
const db=new DatabaseSync(':memory:');
let rows,allRows,files;
try{
  db.exec(readFileSync(join(ROOT,'db/schema-katalog.sql'),'utf8'));
  files=readdirSync(join(ROOT,'db/katalog')).filter(x=>/^prisliste_insert_\d{2}\.sql$/.test(x)).sort();
  if(files.length!==6)throw Error('REQUIRES_SIX_VERSIONED_CATALOGUE_FILES');
  for(const f of files){
    const sql=readFileSync(join(ROOT,'db/katalog',f),'utf8');
    catalogueHash.update(f+'\0'+sql);
    db.exec(sql);
  }
  allRows=db.prepare('SELECT COUNT(*) AS n FROM glass_prisliste').get().n;
  rows=db.prepare("SELECT varenr,varenavn,kommentar,eurokode FROM glass_prisliste WHERE rad_type = 'glass'").all();
}finally{db.close();}
const catalogueSha256=catalogueHash.digest('hex');
const index=buildClassDCandidates(rows);
const buckets=new Map();
for(const candidate of index){
  for(const f of FAMILIER){
    const k=f.merke+' '+f.familie;
    if(candidate.matchReason===k||candidate.matchReason.startsWith(k+' ')){
      if(!buckets.has(k))buckets.set(k,[]);
      buckets.get(k).push(candidate);
      break;
    }
  }
}
const resolver=new ApplicationResolver({families:buildDefaultGenerationRegistry()});
const family=(mk,mo)=>FAMILIER.find(x=>x.merke===mk&&x.re.test(mo));
const frequency=new Map();
for(const v of source.cases){
  const {make:mk,model:mo}=canonicalVehicleName(v.make,v.model),f=family(mk,mo);
  const k=f?mk+' '+f.familie:mk+' '+mo;
  frequency.set(k,(frequency.get(k)??0)+1);
}
const totals={eligibleVehicles:source.cases.length,withCandidates:0,withoutCandidates:0,
  oneCandidate:0,multipleCandidates:0,candidateRows:0,uniqueEurocodes:0,
  applicationCandidateVehicles:0,identityConflicts:0,generationAmbiguousVehicles:0,
  unknownEurocodePositionVehicles:0,discriminatingQuestionVehicles:0,
  invalidVinFormatVehicles:0,missingVinVehicles:0,normalizedModelNames:0,
  oldOpenCatalogueWindowVehicles:0,
  independentOEProof:0,automaticExact:0};
const allCodes=new Set(),noCandidateReasons={},riskReasons={},byFamily=new Map(),enriched=[];
for(const v of source.cases){
  const canonical=canonicalVehicleName(v.make,v.model);
  const {make:mk,model:mo}=canonical,f=family(mk,mo);
  const familyKey=f?mk+' '+f.familie:null;
  const familyRows=familyKey?(buckets.get(familyKey)??[]):[];
  const found=matchClassDCandidates(familyRows,mk,mo,v.year);
  // OLD open-ended year ranges (e.g. 'OCTAVIA 97-') can still be
  // candidate evidence for a 2018 car. Flag this for manual verification,
  // never infer that the early product fits a newer vehicle generation.
  const oldOpenCandidates=found.filter(c=>{
    const m=/(\d{4})–$/.exec(c.matchReason);
    return m && v.year-Number(m[1])>8;
  }).length;
  const app=resolver.resolve({make:mk,model:mo,modelYear:v.year}).applications;
  const codes=[...new Set(found.map(x=>x.eurokode).filter(Boolean))].sort();
  const unknown=found.filter(x=>parseEurocodePosition(x.eurokode).position==='UNKNOWN').length;
  const featureNames=['camera','rainSensor','heated','hud','antenna','coated','acoustic','encapsulated'];
  const questions=featureNames.filter(name=>{
    const values=new Set(found.map(x=>x.featureEvidence?.states?.[name]??null));
    return values.size>1&&[...values].some(x=>typeof x==='boolean');
  });
  const contradicted=found.some(x=>x.featureEvidence?.warnings?.length);
  let noHit=null;
  if(!found.length){
    if(!f)noHit=FAMILIER.some(x=>x.merke===mk)?'MODEL_FAMILY_NOT_SUPPORTED':'BRAND_NOT_SUPPORTED';
    else if(!familyRows.length)noHit='CATALOGUE_HAS_NO_FAMILY_ROWS';
    else if(!matchClassDCandidates(familyRows,mk,mo,null).length)noHit='NO_WINDSCREEN_ROWS_AFTER_FILTER';
    else noHit='YEAR_OUTSIDE_DOCUMENTED_CATALOGUE_WINDOW';
    noCandidateReasons[noHit]=(noCandidateReasons[noHit]??0)+1;
  }
  const reasonCodes=[];
  if(v.identityStatus==='CONFLICT')reasonCodes.push('IDENTITY_CONFLICT');
  if(v.vinFormatValid===false)reasonCodes.push('VIN_FORMAT_INVALID');
  if(v.hasVin===false)reasonCodes.push('VIN_MISSING');
  if(!app.length)reasonCodes.push('APPLICATION_UNRESOLVED');
  else if(app.length>1)reasonCodes.push('GENERATION_UNRESOLVED');
  if(found.length>1)reasonCodes.push('MULTIPLE_GLASS_CANDIDATES');
  if(oldOpenCandidates)reasonCodes.push('OLD_OPEN_CATALOGUE_YEAR_WINDOW');
  if(unknown)reasonCodes.push('UNKNOWN_GLASS_POSITION_FORMAT');
  if(contradicted)reasonCodes.push('CONTRADICTORY_CATALOGUE_FEATURES');
  if(questions.length)reasonCodes.push('DISTINGUISHING_EQUIPMENT_UNKNOWN');
  if(noHit)reasonCodes.push(noHit);
  reasonCodes.push('INDEPENDENT_VEHICLE_TO_OE_PROOF_MISSING');
  for(const r of reasonCodes)riskReasons[r]=(riskReasons[r]??0)+1;
  const key=familyKey??mk+' '+mo,reach=frequency.get(key)??1;
  const priorityScore=Math.min(30,reach*2)
    +(v.identityStatus==='CONFLICT'?80:0)+(found.length===0?28:0)
    +(found.length>1?18:0)+(app.length!==1?12:0)
    +(unknown?20:0)+(contradicted?16:0)
    +Math.min(20,questions.length*5)+(v.stratum==='GENERATION_BOUNDARY'?20:0);
  const nextAction=v.identityStatus==='CONFLICT'?'VERIFY_CONFLICTING_VEHICLE_IDENTITY'
    :!f?'ENRICH_MODEL_FAMILY'
    :!found.length?'REVIEW_CATALOGUE_AND_YEAR'
    :app.length!==1?'VERIFY_GENERATION_AND_OE'
    :found.length>1?'COLLECT_VEHICLE_OE_AND_VARIANT_FEATURES'
    :'COLLECT_INDEPENDENT_VEHICLE_OE_TO_GLASS_EVIDENCE';
  totals.normalizedModelNames+=canonical.changed?1:0;
  totals.oldOpenCatalogueWindowVehicles+=oldOpenCandidates>0?1:0;
  totals.invalidVinFormatVehicles+=v.vinFormatValid===false?1:0;
  totals.missingVinVehicles+=v.hasVin===false?1:0;
  totals.withCandidates+=found.length>0?1:0;
  totals.withoutCandidates+=found.length===0?1:0;
  totals.oneCandidate+=found.length===1?1:0;
  totals.multipleCandidates+=found.length>1?1:0;
  totals.candidateRows+=found.length;
  totals.applicationCandidateVehicles+=app.length>0?1:0;
  totals.identityConflicts+=v.identityStatus==='CONFLICT'?1:0;
  totals.generationAmbiguousVehicles+=app.length>1?1:0;
  totals.unknownEurocodePositionVehicles+=unknown>0?1:0;
  totals.discriminatingQuestionVehicles+=questions.length>0?1:0;
  for(const code of codes)allCodes.add(code);
  enriched.push({...v,make:mk,model:mo,modelNameNormalized:canonical.changed,
    split:sample?.get(v.caseId)??v.split??'UNASSIGNED',
    candidateCount:found.length,candidateDistinctEurocodes:codes.length,candidateEurocodes:codes,
    oldOpenCatalogueCandidateCount:oldOpenCandidates,
    applicationCount:app.length,possibleGenerations:[...new Set(app.map(a=>a.generation).filter(Boolean))].sort(),
    unknownPositionCandidateCount:unknown,distinguishingQuestions:questions,
    noCandidateReason:noHit,reasonCodes,priorityScore,priorityBasis:'CORPUS_FREQUENCY_AND_FITMENT_RISK',
    nextAction,evidenceStatus:'NOT_VERIFIED',confirmedGlass:null,
    decision:'NEEDS_INDEPENDENT_HUMAN_EVIDENCE',autoExact:false});
  const row=byFamily.get(key)??{family:key,vehicles:0,withCandidates:0,noCandidates:0,multiVariants:0,priorityTotal:0};
  row.vehicles++;
  row.withCandidates+=found.length>0?1:0;
  row.noCandidates+=found.length===0?1:0;
  row.multiVariants+=found.length>1?1:0;
  row.priorityTotal+=priorityScore;
  byFamily.set(key,row);
}
totals.uniqueEurocodes=allCodes.size;
if(totals.withCandidates+totals.withoutCandidates!==totals.eligibleVehicles||
  totals.automaticExact!==0||totals.independentOEProof!==0)
  throw Error('CANDIDATE_COUNTS_OR_EVIDENCE_ACCOUNTING_INVALID');
const cohortHash=createHash('sha256');
for(const x of [...enriched].sort((a,b)=>a.caseId.localeCompare(b.caseId)))
  cohortHash.update(x.caseId+'|'+x.make+'|'+x.model+'|'+x.year+';');
const cohortFingerprint=cohortHash.digest('hex');
const report={
  schemaVersion:'full-corpus-intelligence-v1',mode:'OFFLINE_RESEARCH_ONLY',
  catalogue:{source:'GT_AUTO_PRISLISTE',sha256:catalogueSha256,sqlFiles:files.length,
    allRows,glassRows:rows.length,indexedCandidateRows:index.length,
    liveReuseLicenceVerified:false},
  cohort:{fingerprint:cohortFingerprint,vehicles:enriched.length,
    frozenSample:sample?.size??0,holdout:sample?[...sample.values()].filter(x=>x==='HOLDOUT').length:0,
    development:sample?[...sample.values()].filter(x=>x==='DEVELOPMENT').length:0},
  totals,noCandidateReasons,riskReasons,
  priorityFamilies:[...byFamily.values()].sort((a,b)=>b.priorityTotal-a.priorityTotal||a.family.localeCompare(b.family)).slice(0,25),
  safety:{automaticExactActivated:false,networkUsed:false,glavistaUsed:false,
    physicalFitmentPrecisionMeasured:false},
  limitations:['Every catalogue match is a candidate, not proof of installed glass.',
    'VIN format is only a structural check (17 allowed characters), not cryptographic provenance or OEM VIN verification.',
    'Application generations are inferred; not confirmed by OE/build evidence.',
    'Open-ended catalogue year windows older than 8 years are flagged heuristically, NOT verified or automatically narrowed.',
    'Catalogue usage rights need independent confirmation before live integration.',
    'This offline tool does NOT test production decision ports, auth, D1 or payments.']
};
function savePrivate(path,object){
  try{writeFileSync(resolve(path),JSON.stringify(object,null,2)+'\n',{flag:'wx',mode:0o600});}
  catch{throw Error('PRIVATE_OUTPUT_UNAVAILABLE_OR_ALREADY_EXISTS');}
}
savePrivate(opt.report,report);
savePrivate(opt['enriched-queue'],{purpose:'FULL_FLEET_FITMENT_EVIDENCE_GAPS',cohortFingerprint,
  catalogueSha256,sourceLicenceVerified:false,
  cases:enriched.sort((a,b)=>b.priorityScore-a.priorityScore||a.caseId.localeCompare(b.caseId))});
console.log('FBG_FULL_CORPUS_REPORT='+JSON.stringify(report));

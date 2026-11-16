#!/usr/bin/env node
/**
 * Private, offline audit of ALL available vehicles and 30-case validation sample.
 *
 * INPUT: explicitly supplied JSONL/NDJSON, may contain REG/VIN. Files are read
 * locally only, never fetched, uploaded or embedded in reports.
 * OUTPUT: aggregate metrics, optional pseudonymous queue. Never labels EXACT.
 * HMAC key must come from a secret environment variable; no static dev salt.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const args=process.argv.slice(2);
const inputs=[], options={};
for(let i=0;i<args.length;i++){
  if(args[i]==='--input'&&args[i+1]) inputs.push(args[++i]);
  else if(['--report','--sample','--queue'].includes(args[i])&&args[i+1]) options[args[i].slice(2)]=args[++i];
  else throw Error('USAGE: --input LOCAL.jsonl [--input MORE.ndjson] [--report PRIVATE.json] [--queue ALL_PRIVATE.json] [--sample FIRST30_PRIVATE.json]');
}
if(!inputs.length) throw Error('AT_LEAST_ONE_LOCAL_INPUT_REQUIRED');
const key=process.env.FBG_CORPUS_HMAC_KEY;
if(!key || Buffer.byteLength(key,'utf8')<32) throw Error('STRONG_PRIVATE_HMAC_KEY_REQUIRED_32_BYTES');

const hmac=(v)=>createHmac('sha256',key).update(v).digest('hex').slice(0,32);
const clean=(s)=>String(s??'').toUpperCase().trim().replace(/\s+/g,' ');
const get=(row,fields)=>fields.map(k=>row?.[k]).find(x=>x!==undefined&&x!==null&&x!=='');
const classify=(make,model,year)=>{
  const m=make+' '+model;
  if ((/VW|VOLKSWAGEN/.test(make)&&/(TRANSPORTER|GOLF|PASSAT)/.test(model)&&[2003,2010,2015,2016,2019,2020].some(y=>Math.abs(year-y)<=1)) ||
      (/MAZDA/.test(make)&&/CX[- ]?5/.test(model)&&Math.abs(year-2017)<=1) ||
      (/FIAT/.test(make)&&/500/.test(model)&&Math.abs(year-2020)<=1)) return 'GENERATION_BOUNDARY';
  if (/TESLA|POLESTAR/.test(make)||/\b(EV|ELECTRIC|E-GOLF|LEAF|IONIQ|ID[. ]?[3457])\b/.test(m)) return 'EV';
  if (/CAMERA|HUD|SENSOR|ADAS/.test(model)) return 'EQUIPMENT_HINT';
  if(year>=2022) return 'RECENT';
  return 'OTHER';
};
// Link each vehicle by VIN; reconcile REG-only records when a registration has
// exactly ONE observed VIN. A plate shared by different VINs is an identity
// CONFLICT, never an instruction to merge the two physical vehicles.
const vinEntities=new Map();
const regOnlyEntities=new Map();
const regToVins=new Map();
const metrics={sourceFiles:inputs.length,linesRead:0,invalidJson:0,missingVehicleIdentifier:0,
  missingMakeModelYear:0,duplicateVehicleIds:0,uniqueVehicles:0,withVin:0,withReg:0,
  regToVinJoined:0,ambiguousRegistrationLinks:0,conflictingVehicleRecords:0,validRows:0};
const sourceRows={};
const makeEntity=(id,record,hasVin,hasReg,sourceId)=>({
  caseId:'v_'+id,make:record.make,model:record.model,year:record.year,
  hasVin,hasReg,stratum:classify(record.make,record.model,record.year),
  identityStatus:'UNVERIFIED',sources:new Set([sourceId])
});
const absorb=(target,record,sourceId)=>{
  if(target.make!==record.make||target.model!==record.model||target.year!==record.year){
    target.identityStatus='CONFLICT';
    metrics.conflictingVehicleRecords++;
  }
  target.sources.add(sourceId);
  target.hasReg ||= Boolean(record.reg);
  target.hasVin ||= Boolean(record.vin);
};
for(const [sourceIndex,input] of inputs.entries()){
  const sourceId='INPUT_'+String(sourceIndex+1).padStart(2,'0');
  sourceRows[sourceId]=0;
  let stream;
  try {stream=createReadStream(resolve(input),{encoding:'utf8'});}
  catch {throw Error('PRIVATE_INPUT_UNAVAILABLE');}
  const rl=createInterface({input:stream,crlfDelay:Infinity});
  try{
    for await(const line of rl){
      if(!line.trim())continue;
      metrics.linesRead++;
      sourceRows[sourceId]++;
      let row;try{row=JSON.parse(line);}catch{metrics.invalidJson++;continue;}
      const vin=clean(get(row,['vin','VIN','understellsnummer','vehicleIdentificationNumber'])).replace(/\s/g,'');
      const reg=clean(get(row,['regnr','registrationNumber','kjennemerke','plate'])).replace(/\s/g,'');
      if(!vin&&!reg){metrics.missingVehicleIdentifier++;continue;}
      const make=clean(get(row,['merke','make','brand']));
      const model=clean(get(row,['modell','model']));
      const year=Number(get(row,['aar','year','modelYear','modellaar']));
      if(!make||!model||!Number.isInteger(year)||year<1900||year>2100){
        metrics.missingMakeModelYear++;continue;
      }
      metrics.validRows++;
      const record={vin,reg,make,model,year};
      if(vin){
        const target=vinEntities.get(vin);
        if(target)absorb(target,record,sourceId);
        else vinEntities.set(vin,makeEntity(hmac('VIN:'+vin),record,true,Boolean(reg),sourceId));
        if(reg){
          if(!regToVins.has(reg))regToVins.set(reg,new Set());
          regToVins.get(reg).add(vin);
        }
      } else {
        const target=regOnlyEntities.get(reg);
        if(target)absorb(target,record,sourceId);
        else regOnlyEntities.set(reg,makeEntity(hmac('REG:'+reg),record,false,true,sourceId));
      }
    }
  }catch{throw Error('PRIVATE_CORPUS_READ_FAILED');}
}
for(const [reg,vins] of regToVins){
  if(vins.size>1){
    metrics.ambiguousRegistrationLinks++;
    for(const vin of vins)vinEntities.get(vin).identityStatus='CONFLICT';
  }
}
const data=new Map();
for(const item of vinEntities.values())data.set(item.caseId,item);
for(const [reg,item] of regOnlyEntities){
  const vins=regToVins.get(reg);
  if(vins?.size===1){
    const vin=[...vins][0];
    const target=vinEntities.get(vin);
    absorb(target,{...item,reg,vin:''},[...item.sources][0]);
    for(const src of item.sources)target.sources.add(src);
    metrics.regToVinJoined++;
  }else{
    if(vins?.size>1)item.identityStatus='CONFLICT';
    data.set(item.caseId,item);
  }
}
metrics.duplicateVehicleIds=metrics.validRows-data.size;
metrics.uniqueVehicles=data.size;
const vehicles=[...data.values()];
metrics.withVin=vehicles.filter(v=>v.hasVin).length;
metrics.withReg=vehicles.filter(v=>v.hasReg).length;
const stratumCounts={};
const makeCounts={};
for(const v of vehicles){
  stratumCounts[v.stratum]=(stratumCounts[v.stratum]??0)+1;
  makeCounts[v.make]=(makeCounts[v.make]??0)+1;
}
const quotas={GENERATION_BOUNDARY:8,EV:6,EQUIPMENT_HINT:5,RECENT:5,OTHER:6};
const sorted=vehicles.sort((a,b)=>a.caseId.localeCompare(b.caseId));
const selected=[],taken=new Set();
for(const [stratum,n] of Object.entries(quotas)){
  for(const v of sorted.filter(v=>v.stratum===stratum).slice(0,n)){
    selected.push(v);taken.add(v.caseId);
  }
}
for(const v of sorted){if(selected.length>=30)break;if(!taken.has(v.caseId)){selected.push(v);taken.add(v.caseId);}}
// Every eligible vehicle is queued. The first 30 are a dedicated, frozen
// evaluation sample, not a cap on the corpus or future evidence collection.
const selectedSplits=new Map(selected.map((v,i)=>[v.caseId,(i%3===2?'HOLDOUT':'DEVELOPMENT')]));
const caseFor=(v)=>({
  caseId:v.caseId,make:v.make,model:v.model,year:v.year,stratum:v.stratum,
  identityStatus:v.identityStatus,sourceRefs:[...v.sources].sort(),
  split:selectedSplits.get(v.caseId)??'UNASSIGNED',
  evidenceStatus:'NOT_VERIFIED',oeOrBuildEvidence:null,photoOrInstallationEvidence:null,
  confirmedGlass:null,staffVerification:null,
});
const allCases=sorted.map(caseFor);
const sampleCases=selected.map(caseFor);
const report={
  schemaVersion:'private-corpus-audit-v1',mode:'OFFLINE_RESEARCH_ONLY',
  metrics,sourceRows,stratumCounts,
  topMakes:Object.entries(makeCounts).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([make,count])=>({make,count})),
  processing:{eligibleVehicles:vehicles.length,queuedVehicles:allCases.length,pendingEvidence:allCases.length,verifiedExact:0},
  selection:{selected:sampleCases.length,development:sampleCases.filter(x=>x.split==='DEVELOPMENT').length,
    holdout:sampleCases.filter(x=>x.split==='HOLDOUT').length,verifiedExact:0},
  limitations:['REG/VIN are pseudonymized with secret HMAC, not anonymized.',
    'Source provenance, original collection purpose and retention must be checked before use.',
    'Vehicle records are NOT verified OE-to-glass ground truth.',
    'No network, SVV API, Glavista or customer lookup is performed.',
    'No actual fitment accuracy is inferred.']
};
function privateWrite(file,object) {
  // 0600, refuses to overwrite previously generated reports.
  try {writeFileSync(resolve(file),JSON.stringify(object,null,2)+'\n',{flag:'wx',mode:0o600});}
  catch {throw Error('PRIVATE_OUTPUT_UNAVAILABLE_OR_ALREADY_EXISTS');}
}
if(options.report) privateWrite(options.report,report);
if(options.queue) privateWrite(options.queue,{purpose:'ALL_VEHICLES_PENDING_INDEPENDENT_EVIDENCE',cases:allCases});
if(options.sample) privateWrite(options.sample,{purpose:'FIRST_VALIDATION_SAMPLE_ONLY',cases:sampleCases});
console.log('FBG_PRIVATE_CORPUS_REPORT='+JSON.stringify(report));

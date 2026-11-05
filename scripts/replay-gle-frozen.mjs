import {localD1} from './lib/local-d1.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [database, manifestPath, frozenPath, baselinePath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node --import tsx scripts/replay-gle-frozen.mjs DB MANIFEST FROZEN_RESPONSES BASELINE_TS OUTPUT_JSON');
const {resolveFrontrute:before} = await import(pathToFileURL(baselinePath).href);
import {resolveFrontrute as after} from '../src/vin-resolver.ts';
const db=localD1(database);const env={FINNBILGLASS_DB:db};
const manifest=JSON.parse(readFileSync(manifestPath)).biler;
const frozen=JSON.parse(readFileSync(frozenPath)).kontroll;
const results=[];
for(const b of manifest){const c=frozen[b.test_id];const bil={merke:b.merke,modell:b.modell,aar:c?.aar??b.aar,vin:c?.vin??null};
 try{const old=await before(env,bil);const next=await after(env,bil);const ids=r=>(r.kandidater??[]).map(k=>k.variantId??`${k.varenr}:${k.eurokode}`).sort();results.push({id:b.test_id,bil:{merke:b.merke,modell:b.modell,aar:bil.aar},before:{utfall:old.utfall,ids:ids(old)},after:{utfall:next.utfall,ids:ids(next)},changed:JSON.stringify(ids(old))!==JSON.stringify(ids(next))});}catch(e){results.push({id:b.test_id,error:String(e)});}
 if(results.length%100===0)console.log('processed',results.length);
}
const report={count:results.length,errors:results.filter(x=>x.error),changed:results.filter(x=>x.changed),results};writeFileSync(outputPath,JSON.stringify(report,null,2));console.log(JSON.stringify({count:report.count,errors:report.errors.length,changed:report.changed.length}));db.close();

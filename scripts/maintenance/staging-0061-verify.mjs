/** CI-only verification. Never logs database row values, tokens or bookmarks. */
import { readFileSync } from 'node:fs';

function jsonPart(path) {
  const raw = readFileSync(path,'utf8');
  for (const m of raw.matchAll(/(?:^|\n)[ \t]*(\[|\{)/g)) {
    const start=m.index+m[0].lastIndexOf(m[1]);
    const stack=[];let quote=false,escape=false;
    for(let i=start;i<raw.length;i++){
      const c=raw[i];
      if(quote){if(escape)escape=false; else if(c==='\\')escape=true; else if(c==='"')quote=false;}
      else if(c==='"')quote=true;
      else if(c==='['||c==='{')stack.push(c);
      else if(c===']'||c==='}'){
        const p=stack.pop();
        if(p!==(c===']'?'[':'{'))break;
        if(!stack.length){try{return JSON.parse(raw.slice(start,i+1));}catch{break;}}
      }
    }
  }
  throw new Error('D1_QUERY_FORMAT_INVALID');
}
function rows(path){
  const parsed=jsonPart(path);
  const batches=Array.isArray(parsed)?parsed:[parsed];
  if(!batches.length||!Array.isArray(batches[0]?.results)||batches[0]?.success===false)
    throw new Error('D1_QUERY_UNSUCCESSFUL');
  return batches[0].results;
}
const [mode,one,two]=process.argv.slice(2);
const required=['id','payment_provider','kustom_order_id','kustom_hpp_session_id',
  'amount_minor','status','kustom_capture_state','kustom_authorized_at',
  'paid_at','refunded_minor','updated_at'];
if(mode==='pre'){
  const actual=new Set(rows(one).map(x=>x?.name));
  const missing=required.filter(x=>!actual.has(x));
  console.log('Existing payment order columns present: '+(required.length-missing.length)+'/'+required.length);
  if(missing.length){console.error('MISSING REQUIRED COLUMNS: '+missing.join(', '));process.exit(3);}
  const existing=rows(two).map(x=>x?.name);
  console.log('0061 bookkeeping table exists before migration: '+(existing.length>0));
} else if(mode==='post'){
  const names=new Set(rows(one).map(x=>x?.name));
  const expected=['payment_order_id','last_checked_at','outcome','consecutive_errors'];
  const missing=expected.filter(x=>!names.has(x));
  console.log('0061 bookkeeping columns present: '+(expected.length-missing.length)+'/'+expected.length);
  const index=rows(two).some(x=>x?.name==='idx_kustom_reconcile_attempts_checked');
  console.log('0061 cooldown index present: '+index);
  if(missing.length||!index)process.exit(4);
} else throw new Error('ARGUMENTS_INVALID');

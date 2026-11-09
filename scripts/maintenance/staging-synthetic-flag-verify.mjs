// Strict single-row staging QA cleanup. Reads only COUNT and marked fields.
import { readFileSync } from 'node:fs';
const [path,stage]=process.argv.slice(2);
if(!path||!['pre','post'].includes(stage))throw new Error('ARGS_INVALID');
const raw=readFileSync(path,'utf8');
function parse() {
  for(const m of raw.matchAll(/(?:^|\n)[ \t]*(\[|\{)/g)){
    const start=m.index+m[0].lastIndexOf(m[1]),stack=[];
    let quoted=false,escape=false;
    for(let i=start;i<raw.length;i++){
      const c=raw[i];
      if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}
      else if(c==='"')quoted=true;
      else if(c==='['||c==='{')stack.push(c);
      else if(c===']'||c==='}'){
        const p=stack.pop();
        if(p!==(c===']'?'[':'{'))break;
        if(!stack.length){try{return JSON.parse(raw.slice(start,i+1));}catch{break;}}
      }
    }
  }
  throw new Error('INVALID_D1_RESPONSE');
}
const data=parse(),batch=Array.isArray(data)?data[0]:data;
if(batch?.success===false||!Array.isArray(batch?.results)||batch.results.length!==1)
  throw new Error('D1_RESPONSE_UNEXPECTED');
const {n,flagged}=batch.results[0];
if(n!==1||![0,1].includes(flagged))throw new Error('QA_RECORD_NOT_UNIQUE');
if(stage==='post'&&flagged!==1)throw new Error('QA_RECORD_NOT_MARKED');
console.log('STAGING_SYNTHETIC_FLAG '+JSON.stringify({stage,matched:n,isTest:flagged===1}));

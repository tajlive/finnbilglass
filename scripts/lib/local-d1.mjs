import { DatabaseSync } from 'node:sqlite';
export function localD1(path, {readOnly=true}={}) {
 const db=new DatabaseSync(path,{readOnly});
 return {close:()=>db.close(),exec:(sql)=>db.exec(sql),prepare(sql){let args=[];return {sql,bind(...a){args=a;return this;},async all(){return {results:run('all')};},async first(column){const r=run('get')??null;return column&&r?r[column]:r;},async run(){const r=run('run');return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};
 function run(method){const st=db.prepare(sql);if(/\?\d/.test(sql)){return st[method](Object.fromEntries(args.map((v,i)=>[String(i+1),v??null])));}return st[method](...args.map(v=>v??null));}},async batch(stmts){const rs=[];for(const s of stmts)rs.push(await s.run());return rs;}};
}

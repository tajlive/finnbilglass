import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function commercialDb() {
 const sqlite = new DatabaseSync(':memory:');
 sqlite.exec("CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY, navn TEXT, regnr TEXT, status TEXT); INSERT INTO beta_inquiries VALUES(1,'Testkunde','AB12345','CONFIRMED'),(2,'Demokunde','EL12345','NEW');");
 sqlite.exec(readFileSync(new URL('../migrations/0028_inquiry_commercial.sql',import.meta.url),'utf8'));
 return {sqlite,db:{prepare(sql){return {bind(...args){return methods(sql,args)},...methods(sql,[])}}}};
 function methods(sql,args){return {async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}}}}}
}

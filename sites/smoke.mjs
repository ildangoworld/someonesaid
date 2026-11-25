import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
sqlite.exec(readFileSync(new URL('./migrations/0000_initial.sql',import.meta.url),'utf8'));
const DB = {
  prepare(sql) { return {bind(...values) {
    const s=sqlite.prepare(sql);
    return {all:()=>({results:s.all(...values)}),first:()=>s.get(...values),
      run:()=>({meta:s.run(...values)})};
  }}; },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(s=>s.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const root = 'https://test.example';
const env = {DB,HARU_ADMIN_KEY:'hosted-test-only'};
async function call(path,{method='GET',body,session}={}) {
  const response=await worker.fetch(new Request(root+path,{method,
    headers:{Origin:root,...(session ? {Cookie:session} : {})},
    body:body===undefined?undefined:JSON.stringify(body)}),env);
  return {status:response.status,data:await response.json(),session:response.headers.get('set-cookie')?.split(';')[0]};
}
const submit = (path,body,session)=>call(path,{method:'POST',body,session});
assert.equal((await worker.fetch(new Request(root+'/admin'),env)).status,200);
assert.equal((await call('/api/daily')).data.quotes.length,3);
const reader = await submit('/api/signup',{name:'독자',password:'testpassword'});
const operator = await submit('/api/signup',{name:'운영자',password:'testpassword'});
assert.equal(reader.status,200);
assert.equal((await call('/api/admin/dashboard',{session:reader.session})).status,403);
assert.equal((await submit('/api/admin/claim',{key:env.HARU_ADMIN_KEY},operator.session)).status,200);
const quote = await submit('/api/quotes',{text:'한 문장',category:'위로'},reader.session);
assert.equal(quote.status,200);
assert.equal((await submit('/api/quotes',{text:'두 번째',category:'위로'},reader.session)).status,409);
const path = '/api/quotes/'+quote.data.id;
assert.equal((await submit(path+'/comments',{text:'좋아요'},operator.session)).status,200);
assert.equal((await submit(path+'/vote',{value:1},operator.session)).data.up,1);
assert.equal((await submit(path+'/report',{reason:'검토'},operator.session)).status,200);
const dashboard = await call('/api/admin/dashboard',{session:operator.session});
assert.equal(dashboard.data.reports.length,1);
assert.deepEqual(dashboard.data.daily,(await call('/api/daily')).data.quotes);
assert.equal((await submit(path+'/hide',{},operator.session)).status,200);
assert.equal((await call(path)).status,404);
const history = await call('/api/me/submissions',{session:reader.session});
assert.equal(history.data.quotes[0].comments[0].text,'좋아요');
assert.equal(history.data.quotes[0].hidden,true);
assert.equal((await call('/api/me',{method:'DELETE',body:{password:'testpassword'},session:reader.session})).status,200);
assert.equal((await call('/api/me',{session:reader.session})).data.user,null);
console.log('Sites Worker API and permission checks passed');

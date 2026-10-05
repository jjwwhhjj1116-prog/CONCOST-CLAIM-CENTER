import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');

test('CF148 local D1 batch preserves changes guard and rolls back SQL failure',async()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.development.jsonc',import.meta.url),'utf8'));
  const options=convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response()}}',compatibilityDate:config.compatibility_date,d1Databases:['DB']});
  options.telemetry={enabled:false};
  const mf=new Miniflare(options);
  try{
    const db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE qa_schedule (id INTEGER PRIMARY KEY, version INTEGER); CREATE TABLE qa_people (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO qa_schedule VALUES(1,1);');
    const good=await db.batch([
      db.prepare('UPDATE qa_schedule SET version=2 WHERE id=1 AND version=1'),
      db.prepare('INSERT INTO qa_people SELECT 1, ? WHERE changes()=1').bind('synthetic-person')
    ]);
    assert.deepEqual(good.map(result=>result.meta.changes),[1,1]);
    const stale=await db.batch([
      db.prepare('UPDATE qa_schedule SET version=3 WHERE id=1 AND version=1'),
      db.prepare('INSERT INTO qa_people SELECT 2, ? WHERE changes()=1').bind('must-not-exist')
    ]);
    assert.deepEqual(stale.map(result=>result.meta.changes),[0,0]);
    await assert.rejects(db.batch([
      db.prepare('UPDATE qa_schedule SET version=4 WHERE id=1'),
      db.prepare('INSERT INTO qa_people VALUES(3,NULL)')
    ]));
    assert.equal(await db.prepare('SELECT version FROM qa_schedule').first('version'),2);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM qa_people').first('n'),1);
  }finally{await mf.dispose();}
});

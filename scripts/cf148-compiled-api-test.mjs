import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Run after the API build. No tsx loader, source-module access, real fetch or DB.
test('CF148 emitted API loads ES collectors without workspace source files', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawnSync(process.execPath, ['--input-type=commonjs', '-e', String.raw`
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const { fileURLToPath } = require('node:url');
    const { createRequire, registerHooks } = require('node:module');
    const root = process.cwd();
    const sourceRoots = ['apps/api/src', 'apps/cloudflare/src', 'packages/document-engine/src', 'packages/database/src'].map(p => path.resolve(p) + path.sep);
    registerHooks({ resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (result.url.startsWith('file:')) {
        const file = fileURLToPath(result.url);
        assert.ok(!sourceRoots.some(p => file.startsWith(p)), 'Deployment must not load workspace source: ' + file);
        assert.ok(!/\.tsx?$/.test(file), 'No TypeScript loader in deployment');
      }
      return result;
    }});
    assert.throws(() => require('./packages/document-engine/src/es-service.ts'), /Deployment must not load workspace source/);
    let accidentalFetches = 0;
    global.fetch = async () => { accidentalFetches++; throw Error('Real network forbidden'); };
    const { handleServerSettingsRequest } = require('./apps/api/dist/settings/server-settings-adapter.js');
    const { createApiServer } = require('./apps/api/dist/server.js');
    assert.equal(typeof createApiServer, 'function'); // Do not start or instantiate a DB.
    const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
    const { zipSync, strToU8 } = webRequire('fflate');
    const rows = [['공표일 (조사기준)', '전체직종', '일반공사 직 종'], ...Array.from({length:12}, (_,i) => [(2015+i)+'. 1. 1 (이전연도 9월)', '900,000', (200+i)+',001'])];
    const wage = zipSync({'Contents/section0.xml': strToU8('<hp:tbl>'+rows.map(row=>'<hp:tr>'+row.map(cell=>'<hp:tc><hp:t>'+cell+'</hp:t></hp:tc>').join('')+'</hp:tr>').join('')+'</hp:tbl>')});
    let mockCalls = 0;
    const fetcher = async url => { mockCalls++; return String(url).includes('www.cak.or.kr') ? new Response(wage) : new Response('synthetic unavailable', {status:503}); };
    const db = new Proxy({}, {get(){throw Error('Database access forbidden');}});
    (async () => {
      for (const endpoint of ['public', 'pairs']) {
        for (const [roles, method, date, expected] of [[['staff'],'GET','2026-05-01',200],[['viewer'],'GET','2026-05-01',403],[['admin'],'POST','2026-05-01',405],[['admin'],'GET','bad',400]]) {
          let body = '';
          const response = {statusCode:0,setHeader(){},end(text){body=text;}};
          const pathname = '/api/es/sources/' + endpoint;
          const dates = endpoint==='pairs' && date!=='bad' ? 'date=2023-01-01&date=2026-05-01&date=2026-04-30' : 'date='+date;
          const handled = await handleServerSettingsRequest({pathname,method,request:{url:pathname+'?'+dates+'&trade='+encodeURIComponent('건축')+'&grade=3'},response,context:{user:{id:'synthetic',organizationId:'synthetic'},roles},db,masterKey:null,fetcher});
          assert.equal(handled,true); assert.equal(response.statusCode,expected,body);
          if (endpoint==='public' && expected===200) assert.ok(JSON.parse(body).items.some(i=>i.field==='wage' && i.value==='211001'), 'Compiled parser must read synthetic HWPX wages');
        }
      }
      assert.ok(mockCalls>0); assert.equal(accidentalFetches,0);
      console.log('compiled server and 8 route cases PASS; source/network/DB prohibited');
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, child.stdout + child.stderr + String(child.error ?? ''));
  assert.match(child.stdout, /8 route cases PASS/);
});

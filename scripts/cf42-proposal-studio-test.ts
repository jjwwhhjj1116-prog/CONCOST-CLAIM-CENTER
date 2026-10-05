import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';
import { PROPOSAL_COMPANY_MODULE_CONTENT } from '../apps/cloudflare/src/proposal-company-content.js';
import { proposalStudioWorkbook, readProposalDocx, readProposalStudioWorkbook, type ProposalStudioExcelValues } from '../apps/web/src/proposals/proposal-excel.js';

const read=(path:string)=>readFileSync(join(process.cwd(),path),'utf8');
const zipCrcTable=Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit+=1)value=(value&1)!==0?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
const zipCrc32=(bytes:Uint8Array)=>{let crc=0xffffffff;for(const byte of bytes)crc=zipCrcTable[(crc^byte)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;};
const zipU16=(value:number)=>new Uint8Array([value&0xff,(value>>>8)&0xff]);
const zipU32=(value:number)=>new Uint8Array([value&0xff,(value>>>8)&0xff,(value>>>16)&0xff,(value>>>24)&0xff]);
const zipConcat=(parts:Uint8Array[])=>{const output=new Uint8Array(parts.reduce((total,part)=>total+part.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;};
function excelSavedZip(files:Array<{name:string;content:string}>):Uint8Array{const encoder=new TextEncoder();const local:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;for(const file of files){const name=encoder.encode(file.name);const data=encoder.encode(file.content);const crc=zipCrc32(data);const header=zipConcat([zipU32(0x04034b50),zipU16(20),zipU16(0x0800),zipU16(0),zipU16(0),zipU16(0),zipU32(crc),zipU32(data.length),zipU32(data.length),zipU16(name.length),zipU16(0),name,data]);local.push(header);central.push(zipConcat([zipU32(0x02014b50),zipU16(20),zipU16(20),zipU16(0x0800),zipU16(0),zipU16(0),zipU16(0),zipU32(crc),zipU32(data.length),zipU32(data.length),zipU16(name.length),zipU16(0),zipU16(0),zipU16(0),zipU16(0),zipU32(0),zipU32(offset),name]));offset+=header.length;}const directory=zipConcat(central);return zipConcat([...local,directory,zipU32(0x06054b50),zipU16(0),zipU16(0),zipU16(files.length),zipU16(files.length),zipU32(directory.length),zipU32(offset),zipU16(0)]);}
const xmlEsc=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function excelResavedProposal(source:ProposalStudioExcelValues):Uint8Array{const rows=Object.entries(source) as Array<[keyof ProposalStudioExcelValues,string]>;const sharedItems:string[]=[];const sharedIndex=(value:string,rich=false)=>{const index=sharedItems.length;sharedItems.push(rich?`<si><r><t>${xmlEsc(value.slice(0,5))}</t></r><r><t xml:space="preserve">${xmlEsc(value.slice(5))}</t></r></si>`:`<si><t xml:space="preserve">${xmlEsc(value)}</t></si>`);return index;};const sheetRows=rows.map(([code,value],index)=>{const row=index+4;const codeIndex=sharedIndex(code);if(code==='submissionDate'){const serial=Math.floor((Date.parse(`${value}T00:00:00Z`)-Date.UTC(1899,11,30))/86_400_000);return`<row r="${row}"><c r="A${row}" t="s"><v>${codeIndex}</v></c><c r="C${row}" s="2"><v>${serial}</v></c></row>`;}const valueIndex=sharedIndex(value,code==='objective');return`<row r="${row}"><c r="A${row}" t="s"><v>${codeIndex}</v></c><c r="C${row}" t="s"><v>${valueIndex}</v></c></row>`;}).join('');return excelSavedZip([{name:'xl/workbook.xml',content:'<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="제안서 작성" sheetId="1" r:id="rId7"/></sheets></workbook>'},{name:'xl/_rels/workbook.xml.rels',content:'<?xml version="1.0"?><Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/proposal.xml"/></Relationships>'},{name:'xl/sharedStrings.xml',content:`<?xml version="1.0"?><sst count="${sharedItems.length}" uniqueCount="${sharedItems.length}">${sharedItems.join('')}</sst>`},{name:'xl/worksheets/proposal.xml',content:`<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`}]);}
const ADMIN='00000000-0000-4000-8000-000000000042'; const REVIEWER='00000000-0000-4000-8000-000000000043'; const ADMIN_TOKEN='cf42-admin-session-token'; const REVIEW_TOKEN='cf42-review-session-token';
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');}
class SqlStatement{private values:unknown[]=[];constructor(private readonly db:Database,private readonly sql:string){}bind(...values:unknown[]){this.values=values;return this;}async first<T>():Promise<T|null>{const statement=this.db.prepare(this.sql);try{statement.bind(this.values as any[]);return statement.step()?statement.getAsObject() as T:null;}finally{statement.free();}}async all<T>():Promise<{results:T[]}>{const statement=this.db.prepare(this.sql);const results:T[]=[];try{statement.bind(this.values as any[]);while(statement.step())results.push(statement.getAsObject() as T);return{results};}finally{statement.free();}}async run(){this.db.run(this.sql,this.values as any[]);const row=this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];return{success:true,meta:{changes:this.db.getRowsModified(),last_row_id:Number(row??0)}};}}
class SqlD1{constructor(readonly database:Database){}prepare(sql:string){return new SqlStatement(this.database,sql);}async batch(statements:SqlStatement[]){this.database.run('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.run('COMMIT');return results;}catch(reason){this.database.run('ROLLBACK');throw reason;}}}
const request=(path:string,token=ADMIN_TOKEN,init:RequestInit={})=>{const headers=new Headers(init.headers);headers.set('X-Session-Token',token);if(init.body&&!(init.body instanceof FormData))headers.set('Content-Type','application/json');return new Request(`https://preview.example${path}`,{...init,headers});};
async function setup(){const SQL=await initSqlJs();const sql=new SQL.Database();sql.run('PRAGMA foreign_keys=ON');for(const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0014_cf14_proposal_award_workflow.sql','0019_cf27_proposal_authoring.sql','0033_cf42_proposal_studio.sql','0034_cf42_proposal_template_catalog.sql','0036_cf44_proposal_pdf_template_source.sql','0038_cf48_proposal_company_assets.sql','0040_cf52_hermes_bridge_intake_catalog.sql','0044_cf64_proposal_full_chapter_editing.sql','0045_cf65_proposal_common_chapter_12.sql','0046_cf69_proposal_asset_versions.sql','0047_cf72_project_members_calendar.sql'])sql.exec(read(`apps/cloudflare/migrations/${name}`));const now=new Date().toISOString();for(const [id,login,name,roles] of [[ADMIN,'admin@example.invalid','CF42 Admin','["admin"]'],[REVIEWER,'reviewer@example.invalid','CF42 Reviewer','["reviewer"]']] as const)sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)',[id,login,'1'.repeat(32),'2'.repeat(64),100000,name,login,roles,now]);sql.exec(read('apps/cloudflare/migrations/0039_cf51_proposal_prompt_management.sql'));const seededPrompts=[['제안(용역)의 목적','서로 중복되지 않는 목적 5~7개를 작성한다. 각 항목은 프로젝트 문제, 수행 행동, 기대 성과를 충분히 설명하고 없는 사실은 [확인 필요]로 표시하며 최소 450자 이상 작성한다. 의뢰 배경과 클라이언트 관점을 우선 근거로 삼고 확인되지 않은 계약조건이나 수치를 만들지 않는다.'],['당 현장의 핵심 쟁점 분석','의뢰 자료에서 3~5개 핵심 쟁점을 선정하고 상황, 검증 자료와 기준, 클라이언트 영향, 대응 방향을 상세하게 기술하며 근거 없는 사실은 [확인 필요]로 표시한다. 최소 600자 이상 작성하고 각 쟁점마다 실제 확인해야 할 자료와 의사결정 영향을 분명히 구분한다.'],['업무 수행 내용 및 추진 계획','단계, 수행 업무, 세부 내용, 주요 산출물의 네 열로 구성된 Markdown 표를 작성하고 정확한 네 단계의 행동과 산출물을 구체적으로 설명한다. 최소 450자 이상 작성하고 각 단계에는 두 개 이상의 수행 행동과 담당자가 검수할 수 있는 명확한 산출물을 기재한다.']] as const;seededPrompts.forEach(([title,instruction],index)=>sql.run('INSERT INTO preview_proposal_writing_prompts (chapter_number,chapter_title,instruction_text,is_active,version,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)',[index+1,title,instruction,1,1,ADMIN,now]));sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await sha256(ADMIN_TOKEN),ADMIN,now,new Date(Date.now()+3_600_000).toISOString()]);sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await sha256(REVIEW_TOKEN),REVIEWER,now,new Date(Date.now()+3_600_000).toISOString()]);return{sql,env:{DB:new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>} as CloudflareEnv};}

test('CF148 every source template stores fixed chapters and company image references in the initial version',async()=>{
  const {sql,env}=await setup();
  try {
    sql.run("UPDATE preview_proposal_company_assets SET file_data=?,mime_type='image/jpeg',version=2 WHERE asset_key<>'BRAND_LOGO'",[new Uint8Array([255,216,255,217])]);
    const response=await worker.fetch(request('/api/cases',ADMIN_TOKEN,{method:'POST',headers:{'Idempotency-Key':'cf148-fixed-case'},body:JSON.stringify({title:'고정 챕터 합성 검수',claimType:'TYPE-03',description:'로컬 합성 자료',category:{major:'건설 클레임',middle:'TYPE-03',minor:'제안'}})}),env);
    assert.equal(response.status,201,await response.clone().text());
    const caseId=(await response.json() as any).case.id;
    const config=await (await worker.fetch(request('/api/proposal-studio/config'),env)).json() as any;
    let baseline='';let lastProposal:any;let lastInputs:any;
    for(const source of config.sources){
      const created=await worker.fetch(request(`/api/cases/${caseId}/proposals`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({templateId:'CF27-TYPE-03',sourceId:source.id})}),env);
      assert.equal(created.status,201,await created.clone().text());
      const proposal=(await created.json() as any).proposal;
      lastProposal=proposal;lastInputs=JSON.parse(proposal.versions[0].structuredInputsJson);
      const fixed=JSON.parse(proposal.versions[0].structuredInputsJson).chapters.slice(3);
      assert.equal(fixed.length,9);assert.ok(fixed.every((chapter:any)=>chapter.kind==='FIXED'));
      for(const asset of config.assets.filter((asset:any)=>asset.assetKey!=='BRAND_LOGO'&&asset.hasContent&&asset.isActive)){
        assert.ok(fixed.find((chapter:any)=>chapter.number===asset.chapterNumber).body.includes(`/api/proposal-studio/assets/${asset.assetKey}?v=2`),`${source.id}: ${asset.assetKey}`);
      }
      const snapshot=JSON.stringify(fixed);if(baseline)assert.equal(snapshot,baseline,source.id);else baseline=snapshot;
    }
    assert.ok(config.sources.length>1);
    sql.run('UPDATE preview_proposal_company_modules SET is_active=0,version=version+1,updated_by=?,updated_at=?',[ADMIN,new Date().toISOString()]);
    const chapters=lastInputs.chapters.map((chapter:any)=>chapter.number===4||chapter.number===5?{...chapter,body:'담당자가 보존한 동일 본문',editorJson:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'담당자가 보존한 동일 본문'}]}]}}:chapter);
    const saved=await worker.fetch(request(`/api/cases/${caseId}/proposals/${lastProposal.id}/versions`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({clientName:'합성 발주처',projectTitle:'합성 검수 제안서',subtitle:'검수',submissionDate:'2026-09-14',keyIssues:'확인 쟁점',objective:'검수 목적',planNotes:'검수 계획',exclusions:'없음',chapters,includedModuleCodes:[],templateSourceId:lastInputs.templateSourceId,generationMode:'MANUAL',sourceDocumentVersionIds:[],version:lastProposal.version})}),env);
    assert.equal(saved.status,200,await saved.clone().text());
    const savedInputs=JSON.parse((await saved.json() as any).proposal.versions[0].structuredInputsJson);
    assert.equal(savedInputs.chapters[3].body,'담당자가 보존한 동일 본문');
    assert.deepEqual(savedInputs.chapters[3].editorJson,chapters[3].editorJson);
    assert.equal(savedInputs.chapters[4].body,chapters[4].body);
    assert.equal(savedInputs.chapters[5].body,chapters[5].body);
    const ui=read('apps/web/src/proposals/ProposalView.tsx');
    assert.doesNotMatch(ui,/repairDuplicatedCompanyModules|repairLegacyProposalChapterMixup/u,'reopening, including approved versions, must not replace saved HWP images or repeated text');
  } finally {sql.close();}
});

test('CF166 new drafts in all six named template types keep inputs empty and preserve common images',async()=>{
  const {sql,env}=await setup();
  try {
    sql.run("UPDATE preview_proposal_company_assets SET file_data=?,mime_type='image/jpeg',version=2 WHERE asset_key<>'BRAND_LOGO'",[new Uint8Array([255,216,255,217])]);
    const createdCase=await worker.fetch(request('/api/cases',ADMIN_TOKEN,{method:'POST',headers:{'Idempotency-Key':'cf166-six-types'},body:JSON.stringify({title:'신규 초안 입력 합성 검수',claimType:'TYPE-03',description:'실제 입력 전에 쟁점과 계획을 확정하지 않는다',category:{major:'건설 클레임',middle:'TYPE-03',minor:'제안'}})}),env);
    assert.equal(createdCase.status,201,await createdCase.clone().text());
    const caseId=(await createdCase.json() as any).case.id;
    const config=await (await worker.fetch(request('/api/proposal-studio/config'),env)).json() as any;
    assert.equal(config.templateTypes.length,6);
    let fixedSnapshot='';
    for(const type of config.templateTypes){
      assert.ok(type.label&&!/^TYPE-/u.test(type.label),'practitioners see the named type');
      const response=await worker.fetch(request(`/api/cases/${caseId}/proposals`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({templateId:'CF27-TYPE-03',sourceId:type.representativeSourceId})}),env);
      assert.equal(response.status,201,await response.clone().text());
      const proposal=(await response.json() as any).proposal;
      const initial=JSON.parse(proposal.versions[0].structuredInputsJson);
      assert.equal(initial.keyIssues,'');assert.equal(initial.planNotes,'');
      assert.deepEqual(JSON.parse(proposal.versions[0].missingFieldsJson),['clientName','keyIssues','planNotes']);
      assert.ok(initial.chapters[0].body.trim());
      for(const number of [2,3]){
        const chapter=initial.chapters.find((chapter:any)=>chapter.number===number);
        assert.equal(chapter.body,'[작성 필요]');assert.equal(chapter.editorJson,null);
      }
      const stored=JSON.parse(String(sql.exec('SELECT structured_inputs_json FROM preview_proposal_versions WHERE id=?',[proposal.currentVersionId])[0].values[0][0]));
      assert.equal(stored.keyIssues,'');assert.equal(stored.planNotes,'');
      const fixed=JSON.stringify(initial.chapters.slice(3));
      if(fixedSnapshot)assert.equal(fixed,fixedSnapshot,type.label);else fixedSnapshot=fixed;
      for(const asset of config.assets.filter((asset:any)=>asset.assetKey!=='BRAND_LOGO'&&asset.isActive&&asset.hasContent))assert.ok(fixed.includes(`/api/proposal-studio/assets/${asset.assetKey}?v=2`),type.label+': '+asset.assetKey);
      const reopened=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}`),env);
      assert.equal(reopened.status,200);
      assert.equal((await reopened.json() as any).proposal.versions[0].structuredInputsJson,proposal.versions[0].structuredInputsJson);
    }
  } finally {sql.close();}
});

test('CF166 real proposal screen saves typed issues and plan without replacing fixed chapters',async()=>{
  const {sql,env}=await setup();
  const {chromium}=await import('playwright-core');
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:join(process.cwd(),'apps/web'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{
    name:'proposal-input-regression',
    configureServer(s:any){s.middlewares.use(async(req:any,res:any,next:any)=>{
      if(!req.url?.startsWith('/proposal-input-test?'))return next();
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(await s.transformIndexHtml(req.url,'<html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin;</script><script type="module" src="/proposal-input-entry.js"></script></body></html>'));
    });},
    resolveId:(id:string)=>id==='/proposal-input-entry.js'?'\0proposal-input-entry':undefined,
    load:(id:string)=>id==='\0proposal-input-entry'?`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {ProposalView} from '/src/proposals/ProposalView.tsx';
      import '/src/theme-system.css';
      const root=createRoot(document.getElementById('root'));window.paths=[];
      root.render(React.createElement(ProposalView,{routeId:'PROP-03',roles:['admin'],onNavigate:path=>window.paths.push(path)}));
    `:undefined,
  }]});
  await server.listen();
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const created=await worker.fetch(request('/api/cases',ADMIN_TOKEN,{method:'POST',headers:{'Idempotency-Key':'cf166-proposal-screen'},body:JSON.stringify({title:'화면 입력 합성 검수',claimType:'TYPE-03',description:'입력 반영 검수',category:{major:'건설 클레임',middle:'TYPE-03',minor:'제안'}})}),env);
    assert.equal(created.status,201,await created.clone().text());
    const caseId=(await created.json() as any).case.id;
    // Valid synthetic images; no customer data or external provider is used.
    sql.run("UPDATE preview_proposal_company_assets SET file_data=?,mime_type='image/png',version=2 WHERE asset_key<>'BRAND_LOGO'",[new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE3sAAAAASUVORK5CYII=','base64'))]);
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15_000);
    const errors:string[]=[];const requests:Array<{path:string;method:string;body:any}>=[];let initialFixed='';
    const fixedSnapshot=(chapters:any[])=>JSON.stringify(chapters.map(chapter=>({...chapter,excludedCompanyAssetKeys:chapter.excludedCompanyAssetKeys??[]})));
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',async(route:any)=>{
      const incoming=route.request();const url=new URL(incoming.url());
      const path=url.pathname+url.search;const method=incoming.method();
      const bytes=incoming.postDataBuffer();const body=bytes?.toString('utf8');
      requests.push({path,method,body:body?JSON.parse(body):null});
      const response=await worker.fetch(request(path,ADMIN_TOKEN,{method,headers:incoming.headers(),...(body?{body}:{})}),env);
      if(method==='POST'&&path===`/api/cases/${caseId}/proposals`&&response.status===201){
        const payload=await response.clone().json() as any;
        initialFixed=fixedSnapshot(JSON.parse(payload.proposal.versions[0].structuredInputsJson).chapters.slice(3));
      }
      const headers=Object.fromEntries(response.headers.entries());
      await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
    });
    const origin=`http://127.0.0.1:${(server.httpServer!.address() as any).port}`;
    await page.goto(`${origin}/proposal-input-test?caseId=${caseId}`);
    await page.getByRole('button',{name:'이 유형으로 제안서 시작',exact:true}).click();
    await page.getByRole('heading',{name:'클라이언트와 프로젝트 사실을 입력하세요.',exact:true}).waitFor();
    await page.getByLabel('클라이언트명',{exact:false}).fill('합성 발주처');
    await page.getByLabel('당 현장의 핵심 쟁점 분석',{exact:false}).fill('입력한 쟁점: 계약 기준일과 변경 내역 대조');
    await page.getByLabel('제안 목적·의뢰 배경',{exact:false}).fill('입력한 목적: 확인된 사실을 기준으로 검토');
    await page.getByLabel('업무 수행 내용',{exact:false}).fill('입력한 계획: 원가계산서와 현장 사진 대조');
    await page.getByRole('button',{name:'입력 완료 · 초안 작성 방식 선택 →',exact:true}).click();
    await page.getByRole('radio',{name:/수동·외부 LLM/u}).click();
    const manual=page.locator('.proposal-manual-draft');
    await manual.getByRole('button',{name:/^2\./u}).click();
    assert.match(await manual.locator('.ProseMirror').innerText(),/입력한 쟁점/u);
    await manual.locator('.ProseMirror').click();
    await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');
    await manual.getByRole('button',{name:'굵게',exact:true}).first().click();
    assert.equal(await manual.locator('.ProseMirror strong').innerText(),'입력한 쟁점: 계약 기준일과 변경 내역 대조');
    await manual.getByRole('button',{name:/^3\./u}).click();
    assert.match(await manual.locator('.ProseMirror').innerText(),/입력한 계획/u);
    await manual.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');
    await manual.getByRole('button',{name:'표 삽입',exact:true}).click();
    const tableDialog=page.getByRole('dialog',{name:'표 크기 설정',exact:true});
    await tableDialog.getByLabel('행 수',{exact:true}).fill('2');await tableDialog.getByLabel('열 수',{exact:true}).fill('2');
    await tableDialog.getByRole('button',{name:'▦ 2행 × 2열 표 만들기',exact:true}).click();
    const cells=manual.locator('.ProseMirror table th,.ProseMirror table td');
    assert.equal(await cells.count(),4);
    const expectedCells=['자료','검수 기준','현장 사진','캡션 원문 보존'];
    for(let i=0;i<expectedCells.length;i++){await cells.nth(i).click();await page.keyboard.insertText(expectedCells[i]);}
    assert.deepEqual(await cells.allTextContents(),expectedCells);
    await page.getByRole('button',{name:'수동 초안 저장 · 담당자 검수로 →',exact:true}).click();
    await page.getByRole('heading',{name:'갑지·목차와 1~12장 전체를 직접 검수·수정하세요.',exact:true}).waitFor();
    const createPost=requests.find(item=>item.method==='POST'&&item.path===`/api/cases/${caseId}/proposals`);
    const savePost=requests.find(item=>item.method==='POST'&&item.path.endsWith('/versions'));
    assert.ok(createPost);assert.ok(savePost);assert.equal(savePost.body.generationMode,'MANUAL');
    assert.ok(initialFixed);assert.equal(fixedSnapshot(savePost.body.chapters.slice(3)),initialFixed,'the UI must preserve common chapters from creation through save');
    assert.match(savePost.body.chapters[1].body,/입력한 쟁점/u);assert.match(savePost.body.chapters[2].body,/입력한 계획/u);
    for(const text of expectedCells)assert.ok(savePost.body.chapters[2].body.includes(text),'Every edited table cell must reach the normalized body: '+text);
    assert.equal(savePost.body.chapters[1].body,'**입력한 쟁점: 계약 기준일과 변경 내역 대조**');
    const textNodes=(node:any):any[]=>[node,...(node.content??[]).flatMap(textNodes)];
    assert.ok(textNodes(savePost.body.chapters[1].editorJson).some(node=>node.type==='text'&&node.marks?.some((mark:any)=>mark.type==='bold')),'Actual toolbar formatting must reach the saved JSON');
    const savedTable=textNodes(savePost.body.chapters[2].editorJson).find(node=>node.type==='table');
    assert.ok(savedTable);assert.equal(savedTable.content.length,2);
    assert.deepEqual(savedTable.content.flatMap((row:any)=>row.content.map((cell:any)=>textNodes(cell).filter(node=>node.type==='text').map(node=>node.text).join(''))),expectedCells);
    assert.notEqual(savePost.body.chapters[1].body,'[작성 필요]');assert.notEqual(savePost.body.chapters[2].body,'[작성 필요]');
    const proposalId=savePost.path.split('/')[5];
    const reopened=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposalId}`),env);
    assert.equal(reopened.status,200,await reopened.clone().text());
    const stored=JSON.parse((await reopened.json() as any).proposal.versions[0].structuredInputsJson);
    assert.equal(stored.keyIssues,savePost.body.keyIssues);assert.equal(stored.planNotes,savePost.body.planNotes);
    assert.match(stored.chapters[1].body,/입력한 쟁점/u);assert.match(stored.chapters[2].body,/입력한 계획/u);
    assert.equal(stored.chapters[1].body,savePost.body.chapters[1].body);assert.equal(stored.chapters[2].body,savePost.body.chapters[2].body);
    for(const text of expectedCells)assert.ok(stored.chapters[2].body.includes(text),'Every table cell must survive body storage: '+text);
    assert.deepEqual(stored.chapters[1].editorJson,savePost.body.chapters[1].editorJson);
    assert.deepEqual(stored.chapters[2].editorJson,savePost.body.chapters[2].editorJson,'Table cells, widths, marks and structure must survive the real API and DB');
    assert.equal(fixedSnapshot(stored.chapters.slice(3)),fixedSnapshot(savePost.body.chapters.slice(3)),'manual save preserves all common text, JSON and image references');
    assert.equal(fixedSnapshot(stored.chapters.slice(3)),initialFixed);
    await page.reload();
    await page.getByLabel('당 현장의 핵심 쟁점 분석',{exact:false}).waitFor();
    assert.equal(await page.getByLabel('당 현장의 핵심 쟁점 분석',{exact:false}).inputValue(),stored.keyIssues);
    assert.equal(await page.getByLabel('업무 수행 내용',{exact:false}).inputValue(),stored.planNotes);
    await page.getByRole('button',{name:'입력 완료 · 초안 작성 방식 선택 →',exact:true}).click();
    await page.getByRole('radio',{name:/수동·외부 LLM/u}).click();
    await manual.getByRole('button',{name:/^2\./u}).click();
    assert.match(await manual.locator('.ProseMirror').innerText(),/입력한 쟁점/u);
    assert.equal(await manual.locator('.ProseMirror strong').innerText(),'입력한 쟁점: 계약 기준일과 변경 내역 대조');
    await manual.getByRole('button',{name:/^3\./u}).click();
    assert.match(await manual.locator('.ProseMirror').innerText(),/입력한 계획/u);
    assert.deepEqual(await manual.locator('.ProseMirror table th,.ProseMirror table td').allTextContents(),expectedCells,'Reopened editor must retain all cells in their original order');
    assert.equal(requests.filter(item=>item.method==='POST'&&item.path.endsWith('/versions')).length,1,'reopen must not silently save or regenerate');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();sql.close();}
});

test('CF44 stores the exact source template, masks costs, approves, and exports DOCX/PDF/Markdown',async()=>{
  const {sql,env}=await setup();
  // Model administrator-approved common content; real saved DB modules must not
  // be silently replaced by the bundled fallback during creation or reopen.
  const fixtureConfig=await (await worker.fetch(request('/api/proposal-studio/config'),env)).json() as any;
  for(const [code,body] of Object.entries(PROPOSAL_COMPANY_MODULE_CONTENT)){
    const module=fixtureConfig.modules.find((module:any)=>module.code===code);assert.ok(module);
    const approved=await worker.fetch(request(`/api/proposal-studio/modules/${code}`,ADMIN_TOKEN,{method:'PUT',body:JSON.stringify({title:module.title,bodyMarkdown:body,isActive:true,version:module.version})}),env);
    assert.equal(approved.status,200,await approved.clone().text());
  }
  const createdCase=await worker.fetch(request('/api/cases',ADMIN_TOKEN,{method:'POST',headers:{'Idempotency-Key':'cf42-case-create-0001'},body:JSON.stringify({title:'평택 세교 기술용역',claimType:'TYPE-03',description:'예상 용역대가 123,000,000원 검토',category:{major:'건설 클레임',middle:'TYPE-03',minor:'제안'}})}),env);assert.equal(createdCase.status,201,await createdCase.clone().text());const caseId=(await createdCase.json() as {case:{id:string}}).case.id;sql.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)',[caseId,REVIEWER,ADMIN,new Date().toISOString()]);
  const configResponse=await worker.fetch(request('/api/proposal-studio/config'),env);assert.equal(configResponse.status,200);const config=await configResponse.json() as {modules:Array<{code:string;chapterNumber:number}>;sources:Array<{id:string;sourceName:string;isDefault:boolean}>;assets:Array<{assetKey:string;hasContent:boolean}>;writingPrompts:Array<{chapterNumber:number;chapterTitle:string;instructionText:string;version:number}>};assert.equal(config.modules.length,9);assert.equal(config.modules.find((module)=>module.code==='CH12_CLOSING')?.chapterNumber,12);assert.equal(config.sources.length,23);assert.equal(config.assets.length,7);assert.equal(config.writingPrompts.length,3);assert.match(config.writingPrompts[0].instructionText,/5~7개/u);assert.ok(config.assets.every((asset)=>!asset.hasContent));const defaultSource=config.sources.find((source)=>source.isDefault);assert.equal(defaultSource?.id,'CF42-SRC-260728');assert.equal(defaultSource?.sourceName,'260728 평택 세교1구역 리츠 HUG 대응 전력 용역제안서.hwp');
  const deniedPrompt=await worker.fetch(request('/api/proposal-studio/writing-prompts/1',REVIEW_TOKEN,{method:'PUT',body:JSON.stringify({chapterTitle:'제안(용역)의 목적',instructionText:'검토자가 관리자 지침을 바꾸면 안 됩니다.'.repeat(12),isActive:true,version:1})}),env);assert.equal(deniedPrompt.status,403);
  const updatedPrompt=await worker.fetch(request('/api/proposal-studio/writing-prompts/1',ADMIN_TOKEN,{method:'PUT',body:JSON.stringify({chapterTitle:'제안(용역)의 목적',instructionText:'의뢰 자료를 근거로 목적 5~7개를 충분히 작성하고 확인되지 않은 사실은 [확인 필요]로 표시합니다. '.repeat(6),isActive:true,version:1})}),env);assert.equal(updatedPrompt.status,200,await updatedPrompt.clone().text());assert.equal((await updatedPrompt.json() as any).prompt.version,2);
  const jpeg=new Uint8Array(160);jpeg.set([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x01,0x2c,0x02,0x58,0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00]);jpeg.set([0xff,0xd9],jpeg.length-2);const assetForm=new FormData();assetForm.append('file',new File([jpeg],'organization-chart.jpg',{type:'image/jpeg'}));
  const deniedAsset=await worker.fetch(request('/api/proposal-studio/assets/CH06_ORG_CHART',REVIEW_TOKEN,{method:'PUT',body:assetForm}),env);assert.equal(deniedAsset.status,403);
  const uploadedAsset=await worker.fetch(request('/api/proposal-studio/assets/CH06_ORG_CHART',ADMIN_TOKEN,{method:'PUT',body:assetForm}),env);assert.equal(uploadedAsset.status,200,await uploadedAsset.clone().text());const uploaded=(await uploadedAsset.json() as {asset:{hasContent:boolean;width:number;height:number;version:number}}).asset;assert.equal(uploaded.hasContent,true);assert.equal(uploaded.width,600);assert.equal(uploaded.height,300);assert.equal(uploaded.version,2);
  const protectedAsset=await worker.fetch(request('/api/proposal-studio/assets/CH06_ORG_CHART',REVIEW_TOKEN),env);assert.equal(protectedAsset.status,200);assert.equal(protectedAsset.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await protectedAsset.arrayBuffer()),jpeg);
  const created=await worker.fetch(request(`/api/cases/${caseId}/proposals`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({templateId:'CF27-TYPE-03',sourceId:'CF42-SRC-260728'})}),env);assert.equal(created.status,201);let proposal=(await created.json() as {proposal:{id:string;version:number;currentVersionId:string;versions:Array<{structuredInputsJson:string;bodyText:string}>}}).proposal;const initial=JSON.parse(proposal.versions[0].structuredInputsJson) as {chapters:Array<{number:number;title:string;body:string}>;templateSourceId:string;templateSourceName:string};assert.equal(initial.chapters.length,12);assert.equal(initial.templateSourceId,'CF42-SRC-260728');assert.equal(initial.templateSourceName,defaultSource?.sourceName);assert.match(initial.chapters[4].body,/한국부동산원 공사비 검증 분야의 최고 권위자/u);assert.match(initial.chapters[4].body,/평당 700만원 요구를 599만원으로 조정/u);assert.match(initial.chapters[4].body,/평당 750만원 요구를 615만원으로 협상/u);const storedInitial=sql.exec(`SELECT body_text,structured_inputs_json FROM preview_proposal_versions WHERE id='${proposal.currentVersionId}'`)[0].values[0].map(String);assert.match(storedInitial[0],/\[\[PUBLIC_FACT_CH05_GIMPO_ASK\]\]/u);assert.match(storedInitial[1],/\[\[PUBLIC_FACT_CH05_CHEONGDAM_RESULT\]\]/u);assert.doesNotMatch(storedInitial.join('\n'),/700만원|615만원/u);assert.doesNotMatch(proposal.versions[0].bodyText,/123,000,000원/u);assert.match(proposal.versions[0].bodyText,/비공개 협의금액/u);
  const inlineForm=new FormData();inlineForm.append('file',new File([jpeg],'business-area-original.jpg',{type:'image/jpeg'}));inlineForm.append('chapterNumber','6');inlineForm.append('title','업무 영역 원본');inlineForm.append('altText','컨코스트 업무 영역 원본');
  const inlineUpload=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/assets`,ADMIN_TOKEN,{method:'POST',body:inlineForm}),env);assert.equal(inlineUpload.status,201,await inlineUpload.clone().text());const inlineAsset=(await inlineUpload.json() as {asset:{id:string;url:string;width:number;height:number}}).asset;assert.equal(inlineAsset.width,600);assert.equal(inlineAsset.height,300);
  const inlineRead=await worker.fetch(request(inlineAsset.url,REVIEW_TOKEN),env);assert.equal(inlineRead.status,200);assert.deepEqual(new Uint8Array(await inlineRead.arrayBuffer()),jpeg);
  const chapters=initial.chapters.map((chapter)=>({number:chapter.number,title:chapter.title,kind:chapter.number>=4?'FIXED':'VARIABLE',body:chapter.number===1?'직접 작성한 1장 용역 목적입니다. 사실에 근거한 충분한 제안서 본문으로 클라이언트의 의사결정을 지원합니다.':chapter.number===2?'직접 작성한 2장 핵심 쟁점입니다. 제안금액: 98,000,000원 · 계약 쟁점':chapter.number===3?'직접 작성한 3장 업무 수행 계획입니다. 사실 확인과 협상 지원을 단계별로 수행합니다.':chapter.number===6?`### 조직 체계\n\n제안서별 조직 설명\n\n![컨코스트 업무 영역 원본](${inlineAsset.url} "업무 영역 원본")\n\n### 업무 영역\n\n| 분야 | 내용 |\n| --- | --- |\n| 검증 | 제안서별 직접 편집 |`:chapter.number===12?'제안서별로 직접 수정한 맺음말입니다.':`직접 편집한 ${chapter.number}장 회사 고정 모듈입니다. 확인이 필요한 항목은 확인 필요로 표시합니다.`,...(chapter.number===10?{excludedCompanyAssetKeys:['CH10_PUBLICATIONS']}: {})}));
  const saved=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/versions`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({clientName:'세교1구역 조합',projectTitle:'평택 세교 기술용역 제안서',subtitle:'공사비 검증 및 협상 지원',submissionDate:'2026-08-21',keyIssues:'제안금액 98,000,000원과 단가조정',objective:'클라이언트 권익 보호',planNotes:'Fact Finding부터 협상 지원까지 수행',exclusions:'법률의견 제외',chapters,includedModuleCodes:config.modules.map((module)=>module.code),templateSourceId:'CF42-SRC-260728',generationMode:'MANUAL',sourceDocumentVersionIds:[],version:proposal.version})}),env);assert.equal(saved.status,200);proposal=(await saved.json() as {proposal:typeof proposal}).proposal;const savedInputs=JSON.parse(proposal.versions[0].structuredInputsJson) as {templateSourceId:string;templateSourceName:string;chapters:Array<{number:number;title:string;body:string;excludedCompanyAssetKeys?:string[]}>};assert.equal(savedInputs.templateSourceId,'CF42-SRC-260728');assert.equal(savedInputs.templateSourceName,defaultSource?.sourceName);assert.match(savedInputs.chapters[0].body,/직접 작성한 1장 용역 목적/u);assert.match(savedInputs.chapters[1].body,/직접 작성한 2장 핵심 쟁점/u);assert.match(savedInputs.chapters[2].body,/직접 작성한 3장 업무 수행 계획/u);assert.notEqual(savedInputs.chapters[0].body,savedInputs.chapters[1].body);assert.notEqual(savedInputs.chapters[3].body,savedInputs.chapters[4].body);assert.match(savedInputs.chapters[5].body,/제안서별 조직 설명/u);assert.match(savedInputs.chapters[5].body,new RegExp(inlineAsset.id,'u'));assert.deepEqual(savedInputs.chapters[9].excludedCompanyAssetKeys,['CH10_PUBLICATIONS']);assert.match(savedInputs.chapters[11].body,/제안서별로 직접 수정한 맺음말/u);assert.equal(savedInputs.chapters[11].title,'맺음말');assert.doesNotMatch(proposal.versions[0].bodyText,/98,000,000원/u);assert.match(proposal.versions[0].bodyText,/비공개 협의금액/u);
  const review=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/reviews`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({action:'REQUEST_REVIEW',comment:'검토 요청',versionId:proposal.currentVersionId,version:proposal.version})}),env);assert.equal(review.status,200);proposal=(await (await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}`),env)).json() as {proposal:typeof proposal}).proposal;
  const approved=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/reviews`,REVIEW_TOKEN,{method:'POST',body:JSON.stringify({action:'APPROVE',comment:'최종 승인',versionId:proposal.currentVersionId,version:proposal.version})}),env);assert.equal(approved.status,200);proposal=(await (await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}`),env)).json() as {proposal:typeof proposal}).proposal;
  for(const format of ['docx','pdf','md'] as const){const exported=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/render`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({format,versionId:proposal.currentVersionId,version:proposal.version})}),env);assert.equal(exported.status,200,await exported.clone().text());assert.match(exported.headers.get('content-disposition')??'',/attachment;.*filename\*=UTF-8''/iu);assert.match(exported.headers.get('content-type')??'',format==='docx'?/officedocument\.wordprocessingml\.document/iu:format==='pdf'?/application\/pdf/iu:/text\/markdown/iu);const bytes=new Uint8Array(await exported.arrayBuffer());assert.ok(bytes.byteLength>500,`${format} 승인본은 실제 파일 내용을 포함해야 합니다.`);const decoded=new TextDecoder().decode(bytes);if(format==='docx'){assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);assert.match(decoded,/\[Content_Types\]\.xml/u);assert.match(decoded,/word\/document\.xml/u);assert.match(decoded,/word\/styles\.xml/u);assert.match(decoded,/word\/media\/company-01\.jpg/u);assert.match(decoded,/<w:drawing>/u);const organizationIndex=decoded.indexOf('조직 체계');const organizationDrawingIndex=decoded.indexOf('<w:drawing>',organizationIndex);const businessAreasIndex=decoded.indexOf('업무 영역',organizationDrawingIndex);assert.ok(organizationIndex>=0&&organizationDrawingIndex>organizationIndex&&businessAreasIndex>organizationDrawingIndex,'조직도 이미지는 조직 체계와 업무 영역 사이에 배치되어야 합니다.');const docxBuffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;const imported=await readProposalDocx(new File([docxBuffer],'approved-proposal.docx'));assert.equal(imported.length,12);assert.match(imported[0].body,/사실에 근거한 충분한 제안서 본문/u);}else if(format==='pdf'){assert.deepEqual(new TextDecoder().decode(bytes.slice(0,8)),'%PDF-1.7');assert.match(decoded,/%CONCOST-PROPOSAL/u);assert.match(decoded,/\/Subtype \/Image/u);assert.match(decoded,/%%EOF$/u);}else assert.match(decoded,/12\. 맺음말/u);assert.doesNotMatch(decoded,/98,000,000원/u);}
  const receptionList=await worker.fetch(request('/api/proposal-workflow/receptions',ADMIN_TOKEN),env);assert.equal(receptionList.status,200,await receptionList.clone().text());const receptionCandidates=(await receptionList.json() as any).receptions;assert.equal(receptionCandidates.length,1);assert.equal(receptionCandidates[0].proposalId,proposal.id);assert.equal(receptionCandidates[0].receptionStatus,'READY');
  const caseVersion=Number(sql.exec('SELECT version FROM preview_cases WHERE id=?',[caseId])[0].values[0][0]);const received=await worker.fetch(request('/api/proposal-workflow/receptions',ADMIN_TOKEN,{method:'POST',headers:{'Idempotency-Key':'cf56-one-click-reception-0001'},body:JSON.stringify({proposalId:proposal.id,decision:'WON',expectedProposalVersion:proposal.version,expectedCaseVersion:caseVersion})}),env);assert.equal(received.status,200,await received.clone().text());const receivedBody=await received.json() as any;assert.equal(receivedBody.reception.receptionStatus,'WON');assert.equal(sql.exec('SELECT status FROM preview_cases WHERE id=?',[caseId])[0].values[0][0],'CONTRACT');assert.equal(sql.exec('SELECT award_status FROM preview_proposal_links WHERE case_id=?',[caseId])[0].values[0][0],'WON');assert.equal(sql.exec('SELECT COUNT(*) FROM preview_award_decisions WHERE case_id=?',[caseId])[0].values[0][0],1);
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_proposal_exports')[0].values[0][0],3);
  assert.equal(sql.exec("SELECT COUNT(*) FROM preview_proposal_exports WHERE export_format='PDF'")[0].values[0][0],1);
  const approvedText=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/render`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({format:'md',versionId:proposal.currentVersionId,version:proposal.version})}),env);
  assert.equal(approvedText.status,200);
  assert.match(await approvedText.text(),/세교1구역 조합/u,'export must use the reviewed client name, not current project metadata');
  assert.throws(()=>sql.run(`INSERT INTO preview_proposal_versions VALUES ('forged','${proposal.id}','${caseId}',99,'계약금액 1억원','{}','MANUAL',NULL,NULL,'${'a'.repeat(64)}','[]','[]','${'b'.repeat(64)}',0,'${ADMIN}','2026-08-21')`),/cost data must be masked/u);
  sql.close();
});

test('CF49 Gemini proposal chapters must satisfy the 260728 density, issue, and table contract before D1 save',async()=>{
  const {sql,env}=await setup();
  sql.exec(read('apps/cloudflare/migrations/0012_cf12_report_ai_prompts.sql'));
  env.GEMINI_API_KEY='AQ.SYNTHETIC_CF49_ORGANIZATION_KEY';
  const createdCase=await worker.fetch(request('/api/cases',ADMIN_TOKEN,{method:'POST',headers:{'Idempotency-Key':'cf49-case-create-0001'},body:JSON.stringify({title:'세교1구역 리츠 HUG 대응',claimType:'TYPE-03',description:'조합의 사업성 회복과 리츠 매각가, HUG 재원, 계약조건 검토가 필요한 의뢰',category:{major:'건설 클레임',middle:'TYPE-03',minor:'제안'}})}),env);
  assert.equal(createdCase.status,201);const caseId=(await createdCase.json() as any).case.id;
  const created=await worker.fetch(request(`/api/cases/${caseId}/proposals`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({templateId:'CF27-TYPE-03',sourceId:'CF42-SRC-260728'})}),env);
  assert.equal(created.status,201);let proposal=(await created.json() as any).proposal;const initial=JSON.parse(proposal.versions[0].structuredInputsJson) as any;
  const catalog=await worker.fetch(request('/api/proposal-catalog?mode=projects&limit=200',ADMIN_TOKEN),env);assert.equal(catalog.status,200,await catalog.clone().text());const catalogBody=await catalog.json() as any;assert.equal(catalogBody.source,'preview_proposals');assert.equal(catalogBody.proposals.length,1);assert.equal(catalogBody.proposals[0].id,proposal.id);assert.equal(catalogBody.proposals[0].caseId,caseId);assert.equal(catalogBody.proposals[0].proposalTitle,'세교1구역 리츠 HUG 대응 기술제안서');
  const chapter2={chapter:2,title:'당 현장의 핵심 쟁점 분석',issues:Array.from({length:5},(_value,index)=>({no:index+1,heading:`핵심 쟁점 ${index+1}`,body:`ㅇ 현재 의뢰 자료에서 확인된 사업 조건과 계약 구조를 기준으로 쟁점 ${index+1}을 검증해야 합니다. 계약서, 사업수지, 공사비 내역의 일치 여부를 확인하고 누락된 근거는 [확인 필요]로 분리합니다. 따라서 조합의 재산권과 협상 조건에 미치는 영향을 정리할 필요가 있습니다.`}))};
  const chapter1={chapter:1,title:'용역의 목적',slogan:'조합원의 재산권을 지키는 것',bullets:Array.from({length:6},(_value,index)=>`ㅇ 목적 ${index+1}: 조합이 확인한 사업 여건과 계약 자료를 근거로 핵심 문제를 검토하고 의사결정 기준과 협상 자료를 마련합니다.`),footnote:'※ 법률적 판단 및 법률사무는 당사와 협력하는 법무법인에서 전담하며, 당사는 건설공사비 기술 업무를 담당합니다.'};
  const chapter3={chapter:3,title:'업무 수행 내용',rows:Array.from({length:7},(_value,index)=>({no:index+1,task:`수행 업무 ${index+1}`,detail:['계약서·사업수지·공사비 자료 교차 검토','누락 근거와 추가 질의사항 정리'],deliverables:['쟁점 검토표','협상 지원자료'],mapping:index<5?`쟁점 ${index+1}`:'통합 수행업무'}))};
  const providerBodies:Array<Record<string,unknown>>=[];
  env.GEMINI_TEST_FETCH=async(_input,init)=>{providerBodies.push(JSON.parse(String(init?.body)) as Record<string,unknown>);const content={chapter2,chapter1,chapter3,validation:{result:'FAIL',findings:[{level:'WARNING',location:'2장',issue:'사람 검수 필요',fix:'근거 대조'}]}};return new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(content)}]}]}),{status:200,headers:{'Content-Type':'application/json'}});};
  const payload={clientName:'세교1구역 조합',projectTitle:'세교1구역 리츠 HUG 대응 제안서',subtitle:'사업성 회복과 협상 지원',submissionDate:'2026-08-24',keyIssues:'리츠 매각가 적정성, HUG 재원, 계약조건 변경',objective:'조합원 재산권 보호와 사업 정상화',planNotes:'자료 검증 후 협상 및 의결 지원',exclusions:'법률 판단은 협력 법무법인 수행',chapters:initial.chapters,includedModuleCodes:initial.includedModuleCodes,templateSourceId:'CF42-SRC-260728',generationMode:'AI',sourceDocumentVersionIds:[],version:proposal.version};
  const generated=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/versions`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify(payload)}),env);assert.equal(generated.status,200,await generated.clone().text());proposal=(await generated.json() as any).proposal;
  const savedInputs=JSON.parse(proposal.versions[0].structuredInputsJson) as any;assert.match(savedInputs.chapters[0].body,/조합원의 재산권을 지키는 것/u);assert.match(savedInputs.chapters[1].body,/5\) 핵심 쟁점 5/u);assert.match(savedInputs.chapters[2].body,/\| 단계 \| 수행 업무 \| 세부 내용 \| 주요 산출물 \|/u);assert.equal(savedInputs.aiGenerationTrace.validation.result,'REVIEW_REQUIRED');assert.equal(savedInputs.aiGenerationTrace.validation.fallbackReason,'AI_VALIDATION_REQUIRES_HUMAN_REVIEW');assert.equal(providerBodies.length,1);assert.match(JSON.stringify(providerBodies[0].system_instruction),/2장/u);assert.match(JSON.stringify(providerBodies[0].contents),/sourcePriority/u);assert.match(JSON.stringify(providerBodies[0].system_instruction),/최종 자가검증/u);
  const versionCount=Number(sql.exec(`SELECT COUNT(*) FROM preview_proposal_versions WHERE proposal_id='${proposal.id}'`)[0].values[0][0]);
  env.GEMINI_TEST_FETCH=async()=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({chapter1:'짧은 목적',chapter2:'짧은 쟁점',chapter3:'짧은 계획',chapter12:'짧은 맺음말'})}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
  const rejected=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/versions`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({...payload,chapters:savedInputs.chapters,version:proposal.version})}),env);assert.equal(rejected.status,409);const failure=await rejected.json() as any;assert.equal(failure.code,'PROPOSAL_AI_DRAFT_ALREADY_CREATED');assert.match(failure.error,/사람이 직접 수정/u);assert.equal(Number(sql.exec(`SELECT COUNT(*) FROM preview_proposal_versions WHERE proposal_id='${proposal.id}'`)[0].values[0][0]),versionCount);
  const confirmed=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/reviews`,ADMIN_TOKEN,{method:'POST',body:JSON.stringify({action:'CONFIRM',comment:'4단계 합본 확인',versionId:proposal.currentVersionId,version:proposal.version})}),env);assert.equal(confirmed.status,200,await confirmed.clone().text());const confirmation=await confirmed.json() as any;assert.equal(confirmation.status,'APPROVED');assert.equal(confirmation.phase,'CF50_DIRECT_PROPOSAL_CONFIRMATION');
  sql.close();
});

test('CF42 Excel input round-trips all standard proposal fields and UI exposes the real 4-step editor',async()=>{
  const source:ProposalStudioExcelValues={clientName:'세교1구역 조합',projectTitle:'공사비 검증 제안서',subtitle:'협상 지원 용역',submissionDate:'2026-08-21',keyIssues:'물가변동 기준일',objective:'조합 권익 보호',planNotes:'4단계 수행',exclusions:'법률의견 제외'};
  const bytes=proposalStudioWorkbook(source,'CC-2026-042 · 세교1구역','TYPE-03 12챕터');const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;assert.deepEqual(await readProposalStudioWorkbook(new File([buffer],'proposal.xlsx')),source);
  const ui=read('apps/web/src/proposals/ProposalView.tsx');assert.match(ui,/제안서 초안 작성 방식을 선택하세요/u);assert.match(ui,/수동·외부 LLM/u);assert.match(ui,/saveVersion\('MANUAL',3\)/u);assert.match(ui,/proposal-editor-grid/u);assert.match(ui,/입력 양식 내보내기/u);assert.match(ui,/작성 Excel 가져오기/u);assert.match(ui,/현재 장 Excel/u);assert.match(ui,/HWP\/HWPX 가져오기·편집/u);assert.doesNotMatch(ui,/Word DOCX 가져오기/u);assert.match(ui,/관리자 · 회사 공통 기본 모듈 DB 편집/u);assert.match(ui,/\['03','담당자 검수','갑지·목차·12챕터 편집'\]/u);assert.doesNotMatch(ui,/'사람 검수'/u);
  assert.match(ui,/현재 프로젝트 · 제안서 유형/u);assert.match(ui,/유형별 대표 템플릿/u);assert.match(ui,/유형별 완제품 보기/u);assert.match(ui,/REDEVELOPMENT_FINANCE/u);assert.match(ui,/GENERAL_CLAIM/u);assert.match(ui,/activeProposal\.status!==['"]DRAFT['"]/u);assert.match(ui,/기존 확정본은 보존/u);
  assert.match(ui,/AiGenerationProgressModal/u);assert.match(ui,/setAiGeneration\(\{kind:'draft',status:'running'\}\)/u);assert.match(ui,/setAiGeneration\(\{kind:'improve',status:'running'\}\)/u);assert.match(ui,/4~12장 공통 기본값 전체 적용/u);assert.match(ui,/applyLatestCompanyModules/u);assert.match(ui,/downloadFinalDocument/u);assert.match(ui,/FileFormatIcon/u);assert.match(ui,/download\('hwp'\)/u);assert.doesNotMatch(ui,/setHwpEditorOpen\(true\)[\s\S]{0,160}Word DOCX/u);
  assert.match(ui,/프로젝트당 1회/u);assert.match(ui,/갑지·목차와 1~12장 전체를 직접 검수·수정/u);assert.match(ui,/StructuredDocumentEditor/u);assert.match(ui,/공통 기본값 · 제안서별 편집/u);assert.match(ui,/원본 이미지 삽입/u);assert.match(read('apps/web/src/documents/StructuredDocumentEditor.tsx'),/표 삽입/u);assert.doesNotMatch(ui,/표준 맺음말이라 읽기 전용/u);assert.doesNotMatch(ui,/proposal-variable-preview proposal-direct-editor/u);assert.match(ui,/검수 완료 · 전체 합본 미리보기/u);
  assert.match(ui,/ProposalFinalDocumentPreview/u);assert.match(ui,/갑지부터 목차·맺음말까지 모두 확인하세요/u);assert.match(ui,/제안서를 최종 확정할까요/u);assert.match(ui,/action:'CONFIRM'/u);assert.match(ui,/네 · 제안서 확정/u);
  assert.doesNotMatch(ui,/canResumeReviewerEdits/u);assert.match(ui,/target>=3&&\(!firstThreeComplete\|\|\(dirty&&!currentVersion\)\)/u);assert.match(ui,/target===3&&!step1Missing\.length&&firstThreeComplete&&\(!dirty\|\|Boolean\(currentVersion\)\)/u);assert.match(ui,/onClick=\{\(\)=>goToProposalStep\(2\)\}>← 초안 작성 방식/u);
  const report=read('apps/web/src/routes/PreviewReportStudio.tsx');assert.match(report,/AiGenerationProgressModal/u);assert.match(report,/setGeneratingOutline\(true\)/u);assert.match(report,/outlineProposalError/u);assert.match(report,/kind: 'chapter', status: 'running'/u);assert.match(report,/kind: 'improve', status: 'running'/u);assert.match(report,/보고서 초안 작성/u);assert.match(report,/수동·외부 LLM/u);assert.match(report,/MANUAL-CHAPTER/u);assert.match(report,/REPORT_REFERENCE/u);assert.match(report,/downloadFinalReport/u);assert.match(report,/downloadFinalReport\('hwp'\)/u);
  const modal=read('apps/web/src/components/AiGenerationProgressModal.tsx');assert.match(modal,/role="progressbar"/u);assert.doesNotMatch(modal,/setProgress|Math\.min\(98/u);assert.match(modal,/✓ \{confirmLabel\}/u);assert.match(modal,/아직 완료된 단계는 없습니다/u);assert.match(modal,/elapsedSeconds/u);
  const company=read('apps/cloudflare/src/proposal-company-content.ts');assert.match(company,/우동3구역 주택재개발/u);assert.match(company,/수원고등법원 2025나12266/u);assert.match(company,/\| 담당 \| 성명 \| 학력/u);assert.match(company,/한국부동산원 공사비 검증 분야의 최고 권위자/u);assert.match(company,/김포현장에서 시공사의 평당 700만원 요구를 599만원으로 조정/u);assert.match(company,/청담현장은 평당 750만원 요구를 615만원으로 협상/u);assert.match(company,/\[비공개 협의금액\]/u);
  const docx=read('apps/cloudflare/src/proposal-docx.ts');assert.match(docx,/function markdownTable/u);assert.match(docx,/<w:tbl>/u);assert.match(docx,/function proposalImageDrawing/u);assert.match(docx,/<w:drawing>/u);assert.match(docx,/\/Subtype \/Image/u);assert.match(docx,/proposalBodyWithAssetMarkers/u);assert.match(docx,/normalizeMixedDocumentBlocks/u);assert.match(docx,/PROPOSAL_ASSET/u);assert.match(ui,/ProposalRichContent/u);assert.match(ui,/renderProposalBodyHtml/u);assert.match(ui,/deduplicateProposalImages/u);assert.match(ui,/완제품 구조 미리보기/u);assert.match(ui,/AI 자동작성 시작 · Gemini/u);assert.match(ui,/관리자 · 회사 기본 이미지 DB/u);assert.match(ui,/\/api\/proposal-studio\/assets\//u);assert.match(ui,/proposalImageForUpload/u);assert.match(ui,/nextEditorJson\.content\.push/u);assert.doesNotMatch(ui,/repairDuplicatedCompanyModules|repairLegacyProposalChapterMixup/u);assert.match(ui,/activeProposal(?:\?\.|\.)currentVersionId/u);
  const bundled=read('apps/cloudflare/src/proposal-template-assets.ts');assert.match(bundled,/CH04_EXPERT_PROFILE/u);assert.match(bundled,/CH06_ORG_CHART/u);assert.match(bundled,/CH06_BUSINESS_AREAS/u);assert.match(bundled,/CH10_DEGREE/u);assert.match(bundled,/CH10_APPRAISER/u);assert.match(bundled,/CH10_PUBLICATIONS/u);
  const workerSource=read('apps/cloudflare/src/index.ts');assert.match(workerSource,/FALLBACK_PROPOSAL_TEMPLATE_SYSTEM/u);assert.match(workerSource,/proposalRenderedAiChapter/u);assert.match(workerSource,/issues\.length<5\|\|issues\.length>6/u);assert.match(workerSource,/bullets\.length<5\|\|bullets\.length>7/u);assert.match(workerSource,/\| 단계 \| 수행 업무 \| 세부 내용 \| 주요 산출물 \|/u);assert.match(workerSource,/PROPOSAL_AI_DRAFT_ALREADY_CREATED/u);assert.match(workerSource,/writing-prompts/u);assert.match(workerSource,/bodyMarkdown:hydrateProposalPublishedFacts\(bodyMarkdown\)/u);
  const settings=read('apps/web/src/routes/PreviewSettings.tsx');const promptMigration=read('apps/cloudflare/migrations/0039_cf51_proposal_prompt_management.sql');assert.match(settings,/제안서 작성 지침/u);assert.match(settings,/템플릿별 공통 규칙 · 1~3장 작성 지침/u);assert.match(settings,/saveProposalPromptProfile/u);assert.match(settings,/saveProposalPrompt/u);assert.match(promptMigration,/preview_proposal_writing_prompts/u);assert.match(promptMigration,/chapter_number BETWEEN 1 AND 3/u);
  const api=read('apps/web/src/api.ts');assert.match(api,/document\.body\.appendChild\(anchor\)/u);assert.match(api,/anchor\.remove\(\)/u);assert.match(api,/10_000/u);
  const shell=read('apps/web/src/layout/AppShell.tsx');const theme=read('apps/web/src/theme-system.css');assert.match(shell,/sidebar-resize-handle/u);assert.match(shell,/claim-center-sidebar-width/u);assert.match(shell,/if \(stored === null\) return SIDEBAR_DEFAULT_WIDTH/u);assert.match(theme,/\.sidebar \{ width: 352px/u);assert.match(theme,/\.case-create-page \{ width: 100%; max-width: 1480px/u);assert.match(theme,/\.proposal-step-card > \.proposal-editor-stage \{ order:4; \}/u);assert.match(theme,/data-resize-wrapper\]\{width:min\(88%,820px\)/u);assert.match(theme,/img\[src\*="\/api\/proposal-studio\/assets\/"\]:not\(\[width\]\).*width:min\(88%,820px\)/u);assert.doesNotMatch(theme,/\.proposal-editor-stage\s*\{\s*display:none\s*!important/u);
  const router=read('apps/web/src/routes/Router.tsx');assert.match(shell,/label: '프로젝트 보고서'/u);assert.match(shell,/routeIds: \['REPO-02', 'REPO-03', 'REPO-04'\]/u);assert.match(router,/path: '\/reports\/projects', name: '프로젝트별 보고서 목록'/u);assert.match(router,/path: '\/reports\/database', name: '보고서 DB관리'/u);assert.match(shell,/claim-center-emblem\.png/u);
  const receptionUi=read('apps/web/src/workflow/ProposalAwardWorkflow.tsx');assert.match(receptionUi,/확정 제안서 선택/u);assert.match(receptionUi,/✓ 수주 확인 · 프로젝트 접수/u);assert.match(receptionUi,/접수 취소/u);assert.match(receptionUi,/routeId === 'WF-02'/u);assert.match(receptionUi,/\/api\/proposal-workflow\/receptions/u);
});

test('CF67 Excel re-save keeps FIELD_CODE values through shared strings, rich text, numeric dates, and a renamed worksheet path',async()=>{
  const source:ProposalStudioExcelValues={clientName:'[LH]',projectTitle:'오늘은 진짜 최악 기술용역 제안서',subtitle:'건설 클레임 전문용역 제안',submissionDate:'2026-08-27',keyIssues:'독소조항, 기준일, 물가변동',objective:'클라이언트 권익 보호',planNotes:'Fact Finding부터 협상 지원',exclusions:'법률의견 제외'};
  const bytes=excelResavedProposal(source);
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  assert.deepEqual(await readProposalStudioWorkbook(new File([buffer],'excel-resaved-proposal.xlsx')),source);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const ADMIN_ID = '00000000-0000-4000-8000-000000000027';
const ADMIN_TOKEN = 'cf27-admin-session-token';
async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
class SqlStatement { private values: unknown[]=[]; constructor(private readonly database: Database,private readonly sql:string){} bind(...values:unknown[]):SqlStatement{this.values=values;return this;} async first<T>():Promise<T|null>{const statement=this.database.prepare(this.sql);try{statement.bind(this.values as any[]);return statement.step()?statement.getAsObject() as T:null;}finally{statement.free();}} async all<T>():Promise<{results:T[]}>{const statement=this.database.prepare(this.sql);const results:T[]=[];try{statement.bind(this.values as any[]);while(statement.step())results.push(statement.getAsObject() as T);return{results};}finally{statement.free();}} async run():Promise<{success:boolean;meta:{changes:number;last_row_id:number}}>{this.database.run(this.sql,this.values as any[]);const row=this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];return{success:true,meta:{changes:this.database.getRowsModified(),last_row_id:Number(row??0)}};} }
class SqlD1 { constructor(readonly database:Database){} prepare(sql:string):SqlStatement{return new SqlStatement(this.database,sql);} async batch(statements:SqlStatement[]):Promise<unknown[]>{this.database.run('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());this.database.run('COMMIT');return results;}catch(error){this.database.run('ROLLBACK');throw error;}} }
const request=(path:string,init:RequestInit={}):Request=>{const headers=new Headers(init.headers);headers.set('X-Session-Token',ADMIN_TOKEN);if(init.body)headers.set('Content-Type','application/json');return new Request(`https://preview.example${path}`,{...init,headers});};
async function setup():Promise<{sql:Database;env:CloudflareEnv}>{const SQL=await initSqlJs();const sql=new SQL.Database();sql.run('PRAGMA foreign_keys=ON');for(const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql','0019_cf27_proposal_authoring.sql'])sql.exec(read(`apps/cloudflare/migrations/${name}`));const now=new Date().toISOString();sql.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)',[ADMIN_ID,'admin','1'.repeat(32),'2'.repeat(64),100000,'CF27 Admin','admin@example.invalid','["admin"]',now]);sql.run('INSERT INTO preview_sessions VALUES (?,?,?,?)',[await sha256(ADMIN_TOKEN),ADMIN_ID,now,new Date(Date.now()+3_600_000).toISOString()]);return{sql,env:{DB:new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>}};}

test('CF27 persists intake, creator assignment, selected template, and proposal versions across restart', async () => {
  const {sql,env}=await setup();
  const created=await worker.fetch(request('/api/cases',{method:'POST',headers:{'Idempotency-Key':'cf27-intake-create-0001'},body:JSON.stringify({title:'신규 클레임 의뢰',claimType:'TYPE-03',description:'계약 분쟁 검토',category:{major:'건설 클레임',middle:'TYPE-03',minor:'사건 업무'}})}),env);
  assert.equal(created.status,201); const caseId=(await created.json() as {case:{id:string}}).case.id;
  const visible=await worker.fetch(request('/api/cases?limit=100&q='),env); const visibleBody=await visible.json() as {cases:Array<{id:string}>}; assert.ok(visibleBody.cases.some((item)=>item.id===caseId));
  assert.equal(sql.exec('SELECT COUNT(*) FROM preview_case_assignments')[0].values[0][0],1);
  const templates=await worker.fetch(request('/api/proposal-templates?claimType=TYPE-03'),env); const templateBody=await templates.json() as {templates:Array<{id:string}>}; assert.deepEqual(templateBody.templates.map((item)=>item.id),['CF27-TYPE-03']);
  const proposalResponse=await worker.fetch(request(`/api/cases/${caseId}/proposals`,{method:'POST',body:JSON.stringify({templateId:'CF27-TYPE-03'})}),env); assert.equal(proposalResponse.status,201); const proposal=(await proposalResponse.json() as {proposal:{id:string;version:number;currentVersionId:string}}).proposal;
  const saved=await worker.fetch(request(`/api/cases/${caseId}/proposals/${proposal.id}/versions`,{method:'POST',body:JSON.stringify({background:'계약 분쟁 검토 배경',objective:'쟁점과 대응방안 정리',method:'계약서와 공정자료 분석',expectedOutcome:'기술제안서와 검토계획',exclusions:'법률의견 제외',generationMode:'MANUAL',sourceDocumentVersionIds:[],version:proposal.version})}),env); assert.equal(saved.status,200); const savedBody=await saved.json() as {proposal:{version:number;versions:Array<{versionNumber:number}>}}; assert.equal(savedBody.proposal.version,2); assert.deepEqual(savedBody.proposal.versions.map((item)=>item.versionNumber),[2,1]);
  assert.throws(()=>sql.run("UPDATE preview_proposal_versions SET body_text='forged'"),/append-only/u);
  const exported=sql.export(); const SQL=await initSqlJs(); const restarted=new SQL.Database(exported); assert.equal(restarted.exec('SELECT COUNT(*) FROM preview_proposals')[0].values[0][0],1); assert.equal(restarted.exec('SELECT COUNT(*) FROM preview_proposal_versions')[0].values[0][0],2); restarted.close(); sql.close();
});

test('CF27 project intake continues with the newly created case selected in proposal authoring', () => {
  const cases = read('apps/web/src/case-management/CaseManagement.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const router = read('apps/web/src/routes/Router.tsx');
  assert.match(cases, /\/proposals\/editor\?caseId=\$\{encodeURIComponent\(result\.case\.id\)\}&from=intake/u);
  assert.match(cases, /의뢰 저장 후 제안서 작성/u);
  assert.match(proposal, /new URLSearchParams\(window\.location\.search\)\.get\('caseId'\)/u);
  assert.match(proposal, /res\.cases\.some\(\(item\) => item\.id === preferred\)/u);
  assert.match(proposal, /!activeProposal && selectedCaseId/u);
  assert.match(proposal, /제안서 작성 1단계 · 유형별 템플릿 선택/u);
  assert.ok(
    router.indexOf("previewMode && ['PROP-01', 'PROP-02'].includes(currentRoute.id)") < router.indexOf("previewMode && currentRoute.id !== 'RESP-01'"),
    'preview mode must render the real proposal authoring surface before the generic feature placeholder'
  );
});

test('CF27 live D1 cases are visible in the project schedule instead of static samples only', () => {
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  assert.match(schedule, /apiRequest<\{ cases: LiveCaseRecord\[\] \}>\('\/api\/cases\?limit=100&q='\)/u);
  assert.match(schedule, /liveCases\.map\(\(record\)/u);
  assert.match(schedule, /D1 LIVE PROJECTS · 신규 의뢰 자동 반영/u);
  assert.match(schedule, /\/proposals\/editor\?caseId=\$\{caseId\}&projectId=/u);
  assert.match(schedule, /\/workflow\/award\?caseId=\$\{caseId\}&projectId=/u);
});

test('CF27 settings explains API-key activation and separates personal from admin controls', () => {
  const settings = read('apps/web/src/routes/PreviewSettings.tsx');
  const shell = read('apps/web/src/layout/AppShell.tsx');
  assert.match(shell, /aria-label="내 AI 및 연결 설정 열기"/u);
  assert.match(settings, /API 키를 입력하면 암호화 저장 버튼이 활성화됩니다/u);
  assert.match(settings, /현재 로그인 역할/u);
  assert.match(settings, /조직 공용 API 키·Google Drive 회사 연결은 ADMIN 계정에서만 표시됩니다/u);
  assert.match(settings, /roles\.includes\('admin'\) && <PreviewGoogleDriveSetup/u);
});

test('CF27 D1 create remains atomic and assigns the creator so the record is immediately listable', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  assert.match(worker, /INSERT INTO preview_cases/u);
  assert.match(worker, /INSERT INTO preview_case_assignments \(case_id, user_id, assigned_by, assigned_at\)/u);
  assert.match(worker, /INSERT INTO preview_case_activities/u);
  assert.match(worker, /env\.DB\.batch\(\[/u);
});

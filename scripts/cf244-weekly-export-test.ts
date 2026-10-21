import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {downloadWeeklyWorklog,openingWorklogWeek,weeklyDayText,weeklyWorklogWorkbook,type WeeklyWorklog} from '../apps/web/src/workflow/worklog-week.js';
const requireWeb=createRequire(new URL('../apps/web/package.json',import.meta.url));
const XLSX=requireWeb('xlsx');
// Synthetic server-shaped projection: one latest manual row per author/project/day,
// unique automatic source IDs. History selection and KST event bucketing are API tests.
const days=['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03'];
function fixture():WeeklyWorklog{
 const row={caseId:'case-a',caseNumber:'QA-A',projectTitle:'합성 프로젝트 A',authorId:'staff-a',date:days[0],todayTask:'실측 수량 123.45 검토',tomorrowPlan:'다음 계획 246.9 확인',notes:'특이사항',workHours:0,version:3,dailyGoal:'일일 목표',plannedDetails:'세부 계획',planMemo:'계획 메모',progress:0,status:'대기',remainingTask:'남은 업무',delayReason:'지연 이유',blockers:'장애요인'};
 return {weekStart:days[0],weekEnd:days[6],days:[...days],logs:[row,{...row,caseId:'case-b',caseNumber:'QA-B',projectTitle:'합성 프로젝트 B',todayTask:'B 업무',workHours:null,progress:null},{...row,authorId:'staff-b',todayTask:'다른 직원 비공개',notes:'다른 직원 메모'},{...row,date:days[6],todayTask:'일요일 업무',workHours:8,progress:100,status:'완료'}],automaticEntries:[
 ...['one','two'].map(id=>({id:'activity:'+id,caseId:'case-a',caseNumber:'QA-A',projectTitle:'합성 프로젝트 A',authorId:'staff-a',date:days[0],eventType:'REPORT_SAVED',title:'보고서 저장 · v'+(id==='one'?1:2)})),
 {id:'workflow:three',caseId:'case-b',caseNumber:'QA-B',projectTitle:'합성 프로젝트 B',authorId:'staff-a',date:days[0],eventType:'KICKOFF_SAVED',title:'착수회의 기록 저장'},
 {id:'activity:other',caseId:'case-a',caseNumber:'QA-A',projectTitle:'합성 프로젝트 A',authorId:'staff-b',date:days[0],eventType:'REPORT_SAVED',title:'다른 직원 자동 업무'}]};
}
test('CF244 weekly opening selects last week on Monday, current week on Sunday across year boundary',()=>{
 assert.equal(openingWorklogWeek('2026-12-28'),'2026-12-21');assert.equal(openingWorklogWeek('2027-01-03'),'2026-12-28');
 assert.equal(openingWorklogWeek('2027-01-04'),'2026-12-28');assert.equal(openingWorklogWeek('2027-01-05'),'2027-01-04');
});
test('CF244 day formatter preserves author/day/project and distinguishes zero from unentered hours',()=>{
 const report=fixture(),before=JSON.stringify(report),text=weeklyDayText(report,'staff-a',days[0]);
 assert.ok(!text.includes('다른 직원'));assert.ok(!text.includes('일요일 업무'));
 assert.equal(text.match(/QA-A · 합성 프로젝트 A/g)?.length,1);assert.equal(text.match(/QA-B · 합성 프로젝트 B/g)?.length,1);
 assert.equal(text.match(/자동: 보고서 저장 2회/g)?.length,1);assert.ok(!text.includes(' · v1'));assert.ok(!text.includes(' · v2'));
 const [a,b]=text.split('\n\n');assert.ok(a.includes('업무시간: 0시간'));assert.ok(a.includes('진행률: 0%'));
 assert.ok(!b.includes('업무시간:'));assert.ok(!b.includes('진행률:'));
 assert.equal(weeklyDayText(report,'staff-a',days[1]),'');assert.ok(weeklyDayText(report,'staff-a',days[6]).includes('일요일 업무'));
 assert.equal(JSON.stringify(report),before);
});
test('CF244 actual XLSX binary write/read preserves seven days, manual fields and unique source summary',async()=>{
 const report=fixture(),before=JSON.stringify(report),book=await weeklyWorklogWorkbook(report,{id:'staff-a',name:'합성 직원',position:'담당'});
 const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
 const restored=XLSX.read(bytes,{type:'buffer'});assert.deepEqual(restored.SheetNames,['주간 업무일지']);
 const sheet=restored.Sheets['주간 업무일지'];assert.equal(sheet['!ref'],'A1:H4');assert.equal(sheet.A4.v,'합성 직원 담당');
 for(let i=0;i<7;i++){const col=XLSX.utils.encode_col(i+1);assert.equal(sheet[col+'3'].v,`${days[i]} (${'월화수목금토일'[i]})`);assert.equal(sheet[col+'4'].v,weeklyDayText(report,'staff-a',days[i])||'저장된 업무 없음');}
 const text=sheet.B4.v as string;
 for(const label of ['목표: 일일 목표','세부 계획: 세부 계획','계획 메모: 계획 메모','수행: 실측 수량 123.45 검토','다음 계획: 다음 계획 246.9 확인','미완료: 남은 업무','지연 사유: 지연 이유','장애요인: 장애요인','특이사항: 특이사항','업무시간: 0시간'])assert.ok(text.includes(label),label);
 assert.equal(text.match(/자동: 보고서 저장 2회/g)?.length,1);assert.equal(text.match(/수행: 실측 수량 123.45 검토/g)?.length,1);
 assert.ok(!text.includes('다른 직원'));assert.equal(sheet.B4.t,'s'); // Readable journal text, not numeric accounting cells.
 assert.equal(sheet['!merges'].length,2);assert.equal(JSON.stringify(report),before);
});


test('CF244 cancelled or outdated async export checks scope once and creates no XLSX file',async()=>{
 const report=fixture(),name='CF244-cancel-'+randomUUID();
 const path=resolve(`주간업무일지_${name}_${report.weekStart}.xlsx`);
 assert.equal(existsSync(path),false);let calls=0;
 try{
  await assert.doesNotReject(downloadWeeklyWorklog(report,{id:'staff-a',name,position:'검수'},()=>{calls++;return false;}));
  assert.equal(calls,1);assert.equal(existsSync(path),false,'Stale export must not write a file');
 }finally{if(existsSync(path))unlinkSync(path);} // Only this test's uniquely named accidental output.
});

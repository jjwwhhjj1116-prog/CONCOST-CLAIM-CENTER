export type WeeklyManual={caseId:string;caseNumber:string;projectTitle:string;authorId:string;date:string;todayTask:string;tomorrowPlan:string;notes:string;workHours:number|null;version:number;dailyGoal?:string;plannedDetails?:string;planMemo?:string;progress?:number|null;status?:string;remainingTask?:string;delayReason?:string;blockers?:string};
export type WeeklyAutomatic={id:string;caseId:string;caseNumber:string;projectTitle:string;authorId:string;date:string;title:string;eventType:string};
export type WeeklyWorklog={weekStart:string;weekEnd:string;days:string[];logs:WeeklyManual[];automaticEntries:WeeklyAutomatic[]};
export const worklogToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const validWorklogDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
export const shiftWorklogDay=(day:string,offset:number)=>new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
export const worklogMonday=(day:string)=>shiftWorklogDay(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
export const openingWorklogWeek=(day=worklogToday())=>{const monday=worklogMonday(day);return day===monday?shiftWorklogDay(monday,-7):monday;};
export function weeklyDayText(report:WeeklyWorklog,author:string,day:string){
  const manual=report.logs.filter(row=>row.authorId===author&&row.date===day),automatic=report.automaticEntries.filter(row=>row.authorId===author&&row.date===day);
  const projects=new Map<string,{caseNumber:string;projectTitle:string}>();for(const row of [...automatic,...manual])projects.set(row.caseId,row);
  return [...projects].map(([id,p])=>{
    const lines=[`${p.caseNumber} · ${p.projectTitle}`],log=manual.find(row=>row.caseId===id),counts=new Map<string,{title:string;count:number}>();
    for(const row of automatic.filter(row=>row.caseId===id)){const key=row.eventType,group=counts.get(key)||{title:row.title.replace(/ · v\d+$/,''),count:0};group.count++;counts.set(key,group);}
    for(const group of counts.values())lines.push(`자동: ${group.title} ${group.count}회`);
    if(log){for(const [label,value]of [['목표',log.dailyGoal],['세부 계획',log.plannedDetails],['계획 메모',log.planMemo],['수행',log.todayTask],['진행률',log.progress==null?'':log.progress+'%'],['상태',log.status],['미완료',log.remainingTask],['지연 사유',log.delayReason],['장애요인',log.blockers],['다음 계획',log.tomorrowPlan],['특이사항',log.notes],['업무시간',log.workHours==null?'':log.workHours+'시간']])if(value!==undefined&&value!=='')lines.push(`${label}: ${value}`);}
    return lines.join('\n');
  }).join('\n\n');
}
export async function weeklyWorklogWorkbook(report:WeeklyWorklog,writer:{id:string;name:string;position:string}){
  const XLSX=await import('xlsx'),rows=[['개인별 주간 업무일지'],[`${report.weekStart} ~ ${report.weekEnd}`],['작성자',...report.days.map((d,i)=>`${d} (${'월화수목금토일'[i]})`)],
    [`${writer.name} ${writer.position}`,...report.days.map(day=>weeklyDayText(report,writer.id,day)||'저장된 업무 없음')]],sheet=XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols']=[{wch:18},...report.days.map(()=>({wch:36}))];sheet['!rows']=[{hpt:24},{hpt:20},{hpt:24}];sheet['!merges']=[{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'주간 업무일지');return book;
}
export async function downloadWeeklyWorklog(report:WeeklyWorklog,writer:{id:string;name:string;position:string},isCurrent=()=>true){
  const XLSX=await import('xlsx'),book=await weeklyWorklogWorkbook(report,writer);if(isCurrent())XLSX.writeFile(book,`주간업무일지_${writer.name}_${report.weekStart}.xlsx`);
}

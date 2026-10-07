import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectNativeTocNumbers} from '../apps/web/src/documents/report-native-toc';
import {readQaNativeEngine,matchReferenceSources,assertQaOutputOutsideSources} from './cf183-template-source-gate.mjs';

const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const marker=(text:string)=>/^목차(?:\(계속\)|계속)?$/u.test(text.replace(/\s+/gu,''));
const resultPrefix='CF192_RESULT:';
async function main(){
if(process.argv[2]==='--child'){
  const [, , , id,source,format,expected]=process.argv;assert.match(id,/^TPL-REF-\d{3}$/u);assert.ok(format==='hwp'||format==='hwpx');assert.match(expected,/^[a-f0-9]{64}$/u);
  const bytes=new Uint8Array(readFileSync(source));assert.equal(hash(bytes),expected);const approved=readQaNativeEngine(),module=await import(pathToFileURL(resolve(approved.root,'rhwp.js')).href);await module.default({module_or_path:approved.wasm});
  let document:any,stage='OPEN';const started=Date.now();
  const summary:Record<string,unknown>={id,format,sourceSha256:expected,bytes:bytes.length,implementationSha256:hash(readFileSync('apps/web/src/documents/report-native-toc.ts')),engineWasmSha256:approved.engineSha256,bindingSha256:approved.bindingSha256,sourcePages:null,discoveryPages:null,tocInputPages:null,execution:'ERROR',inspection:'UNVERIFIED',numberRows:null,unchanged:null,candidates:null,excludedByReason:null,errorCode:null};
  try{
    document=new module.HwpDocument(bytes);const count=document.pageCount();assert.ok(Number.isSafeInteger(count)&&count>0);summary.sourcePages=count;
    const windowPages=Array.from({length:Math.min(count,8)},(_,index)=>index+1);summary.discoveryPages=windowPages;stage='MARKER_DISCOVERY';
    const tocPages=new Set<number>();
    // Discovery is not the inspection's TOC-page argument. Do not exclude early
    // body anchors by handing the entire first-eight-page window to the inspector.
    for(let section=0;section<document.getSectionCount();section++)for(let para=0;para<document.getParagraphCount(section);para++){
      const length=document.getParagraphLength(section,para);if(!Number.isSafeInteger(length)||length<1||length>64)continue;
      if(!marker(document.getTextRange(section,para,0,length)))continue;
      try{const position=JSON.parse(document.getPageOfPosition(section,para));if(position.ok===true&&windowPages.includes(position.page+1))tocPages.add(position.page+1);}catch{/* Unmapped marker remains unverified. */}
    }
    for(const physical of windowPages){const runs=JSON.parse(document.getPageTextLayout(physical-1)).runs;assert.ok(Array.isArray(runs));for(const run of runs)if(typeof run.text==='string'&&marker(run.text))tocPages.add(physical);}
    summary.tocInputPages=[...tocPages].sort((a,b)=>a-b);
    if(!tocPages.size){summary.execution='DONE';summary.inspection='NO_CONFIRMED_MARKER_IN_WINDOW';}
    else if(tocPages.size===count){summary.execution='LIMIT';summary.inspection='UNVERIFIED';summary.errorCode='NO_BODY_PAGE_OUTSIDE_TOC';}
    else{
      stage='INSPECT';const inspected=await inspectNativeTocNumbers(bytes,format,[...tocPages],module.HwpDocument);
      summary.numberRows=inspected.numberRows;summary.unchanged=inspected.unchanged;summary.candidates=inspected.candidates.length;
      const reasons:Record<string,number>={};for(const row of inspected.excluded)reasons[row.reason]=(reasons[row.reason]??0)+1;summary.excludedByReason=reasons;
      summary.execution='DONE';summary.inspection=inspected.unsupported?'PARTIAL':inspected.candidates.length?'LIMITED_CANDIDATES':inspected.unchanged?'LIMITED_ALIGNED':'NO_RECOGNIZED_ROWS';
    }
  }catch(error){const code=/\(([A-Z_]+)\)/u.exec(String(error))?.[1];summary.errorCode=code??stage;summary.execution=code?.endsWith('LIMIT')?'LIMIT':'ERROR';}
  finally{document?.free();summary.originalShaUnchanged=hash(readFileSync(source))===expected;summary.elapsedMs=Date.now()-started;console.log(resultPrefix+JSON.stringify(summary));}
}else{
  const sourceRoot=process.env.CF192_SOURCE_ROOT,outputRoot=process.env.CF192_OUTPUT_ROOT,runName=process.env.CF192_RUN_NAME??'survey';assert.ok(sourceRoot&&outputRoot);assert.match(runName,/^[a-z0-9-]+$/u);assert.ok(existsSync(outputRoot));assertQaOutputOutsideSources(sourceRoot,outputRoot,runName+'.json');
  const output=join(realpathSync(outputRoot),runName+'.json');assert.equal(existsSync(output),false,'Preserve earlier survey results; use a new run name');
  const inventory=JSON.parse(readFileSync('docs/templates/reference-inventory.json','utf8')),files=matchReferenceSources(sourceRoot,inventory).filter(file=>/^\.hwpx?$/u.test(file.extension)),approved=readQaNativeEngine();assert.equal(files.length,16);
  const report={scope:'Actual local originals; first eight pages marker discovery and explicit marker-page inspection only. No semantic title inference, edits, PC Hancom or live persistence proof.',implementationSha256:hash(readFileSync('apps/web/src/documents/report-native-toc.ts')),engineWasmSha256:approved.engineSha256,bindingSha256:approved.bindingSha256,results:[] as Array<Record<string,unknown>>};
  for(const file of files){
    console.log(JSON.stringify({id:file.fileId,stage:'START'}));const started=Date.now(),child=spawnSync(process.execPath,['--max-old-space-size=768','--import','tsx','scripts/cf192-native-toc-survey.ts','--child',file.fileId,file.source,file.extension==='.hwp'?'hwp':'hwpx',file.sha256],{encoding:'utf8',windowsHide:true,timeout:60_000,maxBuffer:200_000});
    const timedOut=Boolean(child.error&&'code' in child.error&&child.error.code==='ETIMEDOUT');
    let result:Record<string,unknown>={id:file.fileId,execution:timedOut?'TIMEOUT':'ERROR',inspection:'UNVERIFIED',numberRows:null,unchanged:null,candidates:null,excludedByReason:null,errorCode:'CHILD_EVIDENCE_MISSING'};
    const line=(child.stdout??'').split(/\r?\n/u).find(line=>line.startsWith(resultPrefix));if(line){try{const parsed=JSON.parse(line.slice(resultPrefix.length));assert.equal(parsed.id,file.fileId);assert.equal(parsed.sourceSha256,file.sha256);assert.equal(parsed.format,file.extension.slice(1));assert.equal(parsed.bytes,file.sizeBytes);assert.equal(parsed.implementationSha256,report.implementationSha256);assert.equal(parsed.engineWasmSha256,report.engineWasmSha256);assert.equal(parsed.bindingSha256,report.bindingSha256);result=parsed;}catch{/* Malformed or mismatched child output is not proof. */}}
    if(child.status!==0||child.error||child.signal){result.execution=timedOut?'TIMEOUT':'ERROR';result.inspection='UNVERIFIED';result.numberRows=null;result.unchanged=null;result.candidates=null;result.excludedByReason=null;}
    result.originalShaUnchanged=hash(readFileSync(file.source))===file.sha256;result.elapsedMs=Date.now()-started;report.results.push(result);console.log(JSON.stringify(result));
  }
  assert.equal(hash(readFileSync('apps/web/src/documents/report-native-toc.ts')),report.implementationSha256,'Implementation changed during the survey');
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});assert.ok(report.results.every(result=>result.originalShaUnchanged===true));
}
}
void main().catch(()=>{process.stderr.write('CF192 survey failed; results are unverified.\n');process.exitCode=1;});

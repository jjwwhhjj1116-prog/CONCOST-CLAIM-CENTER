import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transpileModule,ScriptTarget} from 'typescript';
import test from 'node:test';
import {ApiError} from '../apps/web/src/api';
const source=readFileSync('apps/web/src/routes/PreviewReportStudio.tsx','utf8');
const start=source.indexOf('const saveNow = useCallback(')+'const saveNow = useCallback('.length,end=source.indexOf('}, [activeStep, content, dirty',start)+1;
assert.ok(end>start);
const compiled=transpileModule(`(${source.slice(start,end)})`,{compilerOptions:{target:ScriptTarget.ES2022}}).outputText;
for(const mode of ['normal','nested-edit','wrong-json','wrong-step','missing-draft'])test(`CF229 actual save ACK: ${mode}`,async()=>{
 const noOp=()=>{},ref=(current:any)=>({current}),document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before'}]}]},errors:string[]=[],dirty:boolean[]=[],diagnostics:any[]=[];
 const state:any={ApiError,restoringLocal:false,editable:true,saving:false,saveError:'',dirty:true,workspaceDirty:false,
  chapterSaveInFlight:ref(false),generationInFlight:ref(false),outlineSaveInFlight:ref(false),outlineSyncPendingRef:ref(false),draftSaveInFlight:ref(false),
  selectedCaseId:'QA',loadedCaseId:'QA',selectedCaseRef:ref('QA'),titleRef:ref('QA report'),contentRef:ref('Before'),editorJsonRef:ref(document),
  reportHeaderRef:ref(null),reportFrontMatterRef:ref(null),versionRef:ref(3),activeStepRef:ref(4),selectedChapterRef:ref(''),recoveryWriteRef:ref(undefined),
  outlineDirtyRef:ref(false),chapterDraftsRef:ref({}),chapterSavedRef:ref({}),chapterDocumentsRef:ref({}),chapterSavedDocumentsRef:ref({}),
  joinReportPresentation:(body:any)=>body,setSaving:noOp,setSavedAt:noOp,setBackups:noOp,setWorkspaceDirty:noOp,setOutlineSyncPending:noOp,
  setVersion:(n:number)=>state.versionRef.current=n,setSaveError:(s:string)=>errors.push(s),setDirty:(v:boolean)=>dirty.push(v),loadSavedWorkspaces:async()=>[],
  console:{error:(...args:any[])=>diagnostics.push(args)},
  apiRequest:async(_url:string,options:{body:string})=>{const body=JSON.parse(options.body);if(mode==='nested-edit')document.content[0].content[0].text='Newer';return{draft:mode==='missing-draft'?null:{caseId:'QA',title:body.title,content:body.content,editorJson:mode==='wrong-json'?null:body.editorJson,version:4,wizardStep:mode==='wrong-step'?1:4,selectedChapterId:null,updatedAt:'2026-10-16T00:00:00Z'}};}
 };
 const save=runInNewContext(compiled,state);
 assert.equal(await save('MANUAL',false,true),mode==='normal');
 const valid=mode==='normal'||mode==='nested-edit';assert.equal(state.versionRef.current,valid?4:3);
 assert.deepEqual(dirty,valid?[mode==='nested-edit']:[]);
 if(mode==='nested-edit'){assert.equal(document.content[0].content[0].text,'Newer');assert.equal(errors.at(-1),'');}
 if(!valid){assert.match(errors.at(-1)??'',/저장 완료 응답을 확인하지/u);assert.equal(diagnostics.length,1);}
 assert.equal(state.draftSaveInFlight.current,false);
});

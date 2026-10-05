import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCaseOptions } from '../apps/web/src/case-options.js';

test('Case selectors read all pages and refuse partial or repeated results',async()=>{
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const originalFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout,clearTimeout}});
  try{
    const calls:string[]=[];
    let mode='normal';
    globalThis.fetch=async(input)=>{
      const url=new URL(String(input));calls.push(url.search);
      assert.equal(url.searchParams.get('scope'),'project-work');
      assert.equal(url.searchParams.get('stage'),'SITE_SURVEY');
      assert.equal(url.searchParams.get('assignedOnly'),'true');
      assert.equal(url.searchParams.get('q'),'검토 대상');
      const offset=Number(url.searchParams.get('offset'));
      if(mode==='failure'&&offset)throw new Error('network failed');
      const cases=Array.from({length:offset?3:100},(_,i)=>({id:String(mode==='repeat'?i:offset+i)}));
      return Response.json({cases,total:103,nextOffset:mode==='partial'?null:offset?null:100});
    };
    const path='/api/cases?scope=project-work&stage=SITE_SURVEY&limit=100&assignedOnly=true&q='+encodeURIComponent('검토 대상');
    const result=await loadCaseOptions(path);
    assert.equal(result.cases.length,103);assert.equal(result.cases[102].id,'102');assert.equal(calls.length,2);
    for(mode of ['repeat','partial','failure'])await assert.rejects(loadCaseOptions(path));
    for(const path of ['/api/cases?limit=100&assignedOnly=true','/api/cases?limit=100&q=','/api/cases?scope=project-work&limit=100&q=','/api/cases?scope=proposal-authoring&limit=100&q='+encodeURIComponent('한글 & 공백')]){
      const expected=new URL(path,'https://local.invalid');const offsets:number[]=[];
      globalThis.fetch=async(input)=>{
        const url=new URL(String(input));
        for(const key of ['scope','stage','assignedOnly','q','limit'])assert.equal(url.searchParams.get(key),expected.searchParams.get(key));
        const offset=Number(url.searchParams.get('offset'));offsets.push(offset);
        return Response.json({cases:[{id:String(offset)}],total:2,nextOffset:offset?null:1});
      };
      assert.equal((await loadCaseOptions(path)).cases.length,2);assert.deepEqual(offsets,[0,1]);
    }
  }finally{
    globalThis.fetch=originalFetch;
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');
  }
});

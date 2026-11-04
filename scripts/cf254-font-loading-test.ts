import test from 'node:test';
import assert from 'node:assert/strict';
import { watchDocumentFonts } from '../apps/web/src/documents/document-fonts';

test('CF254 font completion preserves refits without a mount-time layout flush', async t => {
  const keys=['document','window','requestAnimationFrame','cancelAnimationFrame'] as const;
  const original=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  function install(events: boolean, ready: Promise<unknown> = Promise.resolve()) {
    const fonts=new EventTarget();let reads=0;
    if(events)Object.assign(fonts,{onloadingdone:null,onloadingerror:null});
    Object.defineProperty(fonts,'ready',{get(){reads++;return ready;}});
    const frames: FrameRequestCallback[]=[],timers: Array<()=>void>=[],cancelledFrames:number[]=[],cancelledTimers:number[]=[];
    const values={document:{fonts},window:{setTimeout:(fn:()=>void)=>{timers.push(fn);return timers.length;},clearTimeout:(id:number)=>cancelledTimers.push(id)},requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.push(fn);return frames.length;},cancelAnimationFrame:(id:number)=>cancelledFrames.push(id)};
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:values[key]});
    return {fonts,frames,timers,cancelledFrames,cancelledTimers,reads:()=>reads};
  }
  try {
    await t.test('completion and error events refit, without reading ready; cleanup removes both subscriptions',()=>{
      const p=install(true);let calls=0;const stop=watchDocumentFonts(()=>calls++);
      assert.equal(p.reads(),0);assert.equal(p.frames.length,0);assert.equal(calls,0);
      p.fonts.dispatchEvent(new Event('loadingdone'));p.fonts.dispatchEvent(new Event('loadingerror'));assert.equal(calls,2);
      stop();p.fonts.dispatchEvent(new Event('loadingdone'));p.fonts.dispatchEvent(new Event('loadingerror'));assert.equal(calls,2);assert.equal(p.reads(),0);
    });
    await t.test('older-browser ready is read only after frame and timeout, and late promises cannot refit an unmounted document',async()=>{
      let resolve!:()=>void;const ready=new Promise<void>(done=>{resolve=done;}),p=install(false,ready);let calls=0;
      const stop=watchDocumentFonts(()=>calls++);assert.equal(p.reads(),0);
      p.frames[0](0);assert.equal(p.reads(),0);p.timers[0]();assert.equal(p.reads(),1);
      stop();resolve();await ready;await Promise.resolve();assert.equal(calls,0);
      assert.deepEqual(p.cancelledFrames,[1]);assert.deepEqual(p.cancelledTimers,[1]);
      const q=install(false);const finish=watchDocumentFonts(()=>calls++);q.frames[0](0);q.timers[0]();await Promise.resolve();assert.equal(calls,1);finish();
    });
  } finally {
    keys.forEach((key,index)=>{if(original[index])Object.defineProperty(globalThis,key,original[index]!);else Reflect.deleteProperty(globalThis,key);});
  }
});

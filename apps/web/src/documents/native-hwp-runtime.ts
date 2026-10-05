import type { NativeHwpEngine } from './editable-hwp-export';

const WASM_SHA='bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44';
const BINDING_SHA='ad01e939079e3518bc76c442bf395ab058a912991ccb54c8b0be7f5a9a760153';
let pending:Promise<NativeHwpEngine>|undefined;

/** Same-origin, pinned runtime only. Never send the document to a conversion service. */
export function loadNativeHwpEngine():Promise<NativeHwpEngine>{
  if(pending)return pending;
  pending=(async()=>{
    const base=new URL('/rhwp/',window.location.origin);
    const response=await fetch(new URL('build-manifest.json',base),{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('HWP 변환 엔진 배포 정보를 읽지 못했습니다.');
    const manifest=await response.json() as {wasm?:string;files?:Array<{path:string;sha256:string}>};
    if(manifest.wasm!==WASM_SHA||!Array.isArray(manifest.files))throw Error('승인된 HWP 변환 엔진 버전이 아닙니다.');
    const binding=manifest.files.find(file=>file.sha256===BINDING_SHA&&file.path==='native/rhwp-ad01e939079e.js');
    const wasm=manifest.files.find(file=>file.sha256===WASM_SHA&&/^assets\/rhwp_bg-[\w-]+\.wasm$/u.test(file.path));
    if(!binding||!wasm)throw Error('편집 가능한 HWP 변환 엔진이 아직 배포되지 않았습니다.');
    const read=async(path:string,expected:string)=>{
      const r=await fetch(new URL(path,base),{signal:AbortSignal.timeout(60000)});
      if(!r.ok)throw Error('HWP 변환 엔진을 내려받지 못했습니다.');
      const bytes=await r.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==expected)throw Error('HWP 변환 엔진 무결성 검사에 실패했습니다.');
      return bytes;
    };
    const [wasmBytes,bindingBytes]=await Promise.all([read(wasm.path,WASM_SHA),read(binding.path,BINDING_SHA)]);
    // Import exactly the verified bytes. Fetching the URL again would allow a
    // different response to execute after the integrity check has passed.
    const verifiedUrl=URL.createObjectURL(new Blob([bindingBytes],{type:'text/javascript'}));
    try{
      const module=await import(/* @vite-ignore */verifiedUrl) as {default:(options:{module_or_path:ArrayBuffer})=>Promise<unknown>;HwpDocument:NativeHwpEngine};
      await module.default({module_or_path:wasmBytes});
      return module.HwpDocument;
    }finally{URL.revokeObjectURL(verifiedUrl);}
  })().catch(error=>{pending=undefined;throw error;});
  return pending;
}

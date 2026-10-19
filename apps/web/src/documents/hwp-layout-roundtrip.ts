import type {JSONContent} from '@tiptap/core';
import DOMPurify from 'dompurify';
import {deflateSync,inflateSync,strFromU8,strToU8,unzipSync} from 'fflate';
import type {NativeHwpDocument,NativeHwpEngine} from './editable-hwp-export';
import {captureEditablePageLayout} from './docx-layout-roundtrip';
import {HWP_IMPORT_DATA_ATTRIBUTES} from './hwp-import-nodes';

const part='ClaimCenterLayout',prefix='/__hwp_import_image__/',limit=2_000_000;
const sha=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b)))).map(n=>n.toString(16).padStart(2,'0')).join('');
type Native=NativeHwpDocument&{addBookmark(s:number,p:number,at:number,name:string):string;getBookmarks():string};
type Binding={path:string;sha256:string};
const nativeStreams=(file:any)=>file.FullPaths.map((path:string,i:number)=>({path:path.slice(path.indexOf('/')+1),entry:file.FileIndex[i]})).filter(({path,entry}:any)=>entry.type===2&&path!==part&&path!=='\u0001Sh33tJ5').sort((a:any,b:any)=>a.path.localeCompare(b.path,'en')) as Array<{path:string;entry:{content:Uint8Array}}>;
const binding=async(file:any):Promise<Binding[]>=>Promise.all(nativeStreams(file).map(async({path,entry})=>({path,sha256:await sha(new Uint8Array(entry.content))})));
const clean=(html:string)=>DOMPurify.sanitize(html,{ADD_ATTR:[...HWP_IMPORT_DATA_ATTRIBUTES,'style','colwidth','colspan','rowspan','width','height']});
const invalid=():never=>{throw Error('HWP 편집 배치의 본문·사진 연결 검증이 실패했습니다. 기존 보고서는 유지됩니다.');};
const visible=(s:string)=>s.replace(/[\s\u200b\ufeff]/gu,'');
const nodes=(n:JSONContent):JSONContent[]=>[n,...(n.content??[]).flatMap(nodes)];

/** HWP stores integer native geometry; retain the current editable web grid
 * separately, bound both ways to the real native text/tables/pictures. */
export async function embedHwpLayout(bytes:Uint8Array,pages:HTMLElement[],Engine:NativeHwpEngine):Promise<Uint8Array>{
  const original=new Engine(bytes) as Native;
  let html:string[],stamped:Uint8Array;
  try{
    const media=new Map<string,string>();
    for(const [path,data]of Object.entries(unzipSync(original.exportHwpx())))if(path.startsWith('BinData/')){const hash=await sha(data);media.set(hash,hash);}
    html=await captureEditablePageLayout(pages,media,prefix);
    const layoutSha=await sha(strToU8(JSON.stringify(html)));
    for(const [i,name]of ['CCLA_','CCLB_'].entries())if(JSON.parse(original.addBookmark(0,0,0,name+layoutSha.slice(i*32,i*32+32))).ok!==true)invalid();
    stamped=original.exportHwp();
  }finally{original.free();}
  const {CFB}=await import('xlsx'),file=CFB.read(stamped,{type:'array'});
  const payload=strToU8(JSON.stringify({version:1,bound:await binding(file),pages:html}));
  if(payload.length>limit)throw Error('HWP 편집 배치가 저장 한도를 넘었습니다.');
  const compressed=deflateSync(payload),data=new Uint8Array(4+compressed.length);new DataView(data.buffer).setUint32(0,payload.length,true);data.set(compressed,4);
  CFB.utils.cfb_add(file,part,data);
  const output=new Uint8Array(CFB.write(file,{type:'array',fileType:'cfb'}));
  const before=new Engine(bytes),after=new Engine(output);
  try{
    if(before.pageCount()!==after.pageCount())invalid();
    for(let p=0;p<before.pageCount();p++)if((before.renderPageSvgWithProfile?.(p,'print')??before.renderPageSvg(p))!==(after.renderPageSvgWithProfile?.(p,'print')??after.renderPageSvg(p)))invalid();
    const reopened=CFB.read(output,{type:'array'});if(JSON.stringify(await binding(reopened))!==JSON.stringify(await binding(file)))invalid();
  }finally{before.free();after.free();}
  return output;
}

/** A native editor may remove this optional stream or change native content.
 * In that case use the actual native importer, never stale web paragraphs. */
export async function readHwpLayout(bytes:Uint8Array,native:NativeHwpDocument,documentJson:JSONContent,images:Array<{key:string;file:File}>):Promise<JSONContent|null>{
  if(bytes[0]!==0xd0||bytes[1]!==0xcf)return null;
  const {CFB}=await import('xlsx'),file=CFB.read(bytes,{type:'array'}),stream=CFB.find(file,part)?.content;
  if(!stream)return null;
  const data=new Uint8Array(stream);if(data.length<5||data.length>limit)invalid();
  const length=new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(0,true);if(length<2||length>limit)invalid();
  let value:{version:number;bound:Binding[];pages:string[]};
  try{value=JSON.parse(strFromU8(inflateSync(data.subarray(4),{out:new Uint8Array(length)})));}catch{return invalid();}
  if(value.version!==1||!Array.isArray(value.bound)||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>60||value.pages.some(p=>typeof p!=='string')||value.pages.length!==native.pageCount())invalid();
  if(JSON.stringify(value.bound)!==JSON.stringify(await binding(file)))return null;
  const hash=await sha(strToU8(JSON.stringify(value.pages))),bookmarks=JSON.parse((native as Native).getBookmarks()) as Array<{name:string}>;
  if(['CCLA_','CCLB_'].some((name,i)=>!bookmarks.some(b=>b.name===name+hash.slice(i*32,i*32+32))))invalid();
  const html=new DOMParser().parseFromString(clean(value.pages.join('')),'text/html');
  if(html.body.children.length!==value.pages.length||[...html.body.children].some(p=>!p.hasAttribute('data-hwp-import-page')))invalid();
  const sourceNodes=nodes(documentJson),text=(n:JSONContent):string=>(n.text??'')+(n.content??[]).map(text).join('');
  if(visible(html.body.textContent??'')!==visible(text(documentJson)))invalid();
  const actualCells=sourceNodes.filter(n=>n.type==='tableCell'||n.type==='tableHeader'),layoutCells=[...html.querySelectorAll('td,th')];
  if(layoutCells.length!==actualCells.length||layoutCells.some((c,i)=>visible(c.textContent??'')!==visible(text(actualCells[i]))))invalid();
  const photoHashes=new Map<string,string>();
  for(const image of images)photoHashes.set(prefix+image.key,await sha(new Uint8Array(await image.file.arrayBuffer())));
  const expected=sourceNodes.filter(n=>n.type==='image').map(n=>String(n.attrs?.src)),actual=[...html.querySelectorAll('img')];
  if(expected.length!==actual.length)invalid();
  for(const [i,image]of actual.entries()){
    const source=image.getAttribute('src')??'',hash=source.startsWith(prefix)?source.slice(prefix.length):'';
    if(!/^[0-9a-f]{64}$/u.test(hash)||photoHashes.get(expected[i])!==hash)return invalid();image.setAttribute('src',expected[i]);
  }
  const {editorHtmlToMarkdown,parseStructuredDocumentMarkdown}=await import('./StructuredDocumentEditor');
  return parseStructuredDocumentMarkdown(editorHtmlToMarkdown(html.body.innerHTML));
}

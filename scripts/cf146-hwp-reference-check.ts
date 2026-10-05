import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
async function main(){
const sourceRoot=process.env.CF146_SOURCE_ROOT;
if(!sourceRoot)throw Error('Set CF146_SOURCE_ROOT to the existing read-only template directory.');
const studioUrl=process.env.CF146_STUDIO_URL;
const studio=studioUrl?new URL(studioUrl):undefined;
if(studio && (studio.protocol!=='http:' || !['127.0.0.1','localhost'].includes(studio.hostname) || studio.username || studio.password))throw Error('Candidate Studio must use a local HTTP address.');
const runName=process.env.CF146_RUN_NAME || (studio?'cf146-reference-candidate':'cf146-reference');
if(!/^[a-zA-Z0-9_-]+$/.test(runName))throw Error('CF146_RUN_NAME must be a simple directory name.');
const all=readdirSync(sourceRoot,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&/\.hwpx?$/i.test(e.name)).map(e=>path.join(e.parentPath,e.name));
const categories=(process.env.CF146_CATEGORIES||'01,03,05,07,09').split(',');
const files=all.filter(f=>categories.some(c=>path.relative(sourceRoot,f).startsWith(c))).sort();
if(!files.length)throw Error('No source documents matched; nothing was verified.');
const output=path.resolve('tmp',runName);mkdirSync(output,{recursive:true});
const sha=(f:string)=>createHash('sha256').update(readFileSync(f)).digest('hex');
const before=files.map(sha);
const {createServer}=await import('../apps/web/qa/vite-server.js');
const server=await createServer({root:fileURLToPath(new URL('../apps/web',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{
 name:'cf146-native-readonly',
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(req.url?.startsWith('/reference/')){const n=Number(req.url.slice(11));if(!Number.isInteger(n)||!files[n]){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','application/octet-stream');res.end(readFileSync(files[n]));return;}
   if(req.url!=='/cf146-native.html')return next();
   res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><body><div id="host" style="width:1100px;height:1200px"></div><script type="module" src="/cf146-native.js"></script></body></html>'));
 });},
 resolveId:id=>id==='/cf146-native.js'?'\0cf146-native':undefined,
 load:id=>id==='\0cf146-native'?`
   import {createEditor} from '@rhwp/editor';
   import {hwpSvgPageForUpload} from '/src/documents/hwp-page-image.ts';
   globalThis.cf146Ready=createEditor(document.getElementById('host'),{studioUrl:${JSON.stringify(studioUrl)},renderer:'canvas2d',requestTimeoutMs:90000}).then(editor=>{globalThis.cf146Native=editor;return true});
   globalThis.cf146Image=hwpSvgPageForUpload;
 `:undefined
}]});
await server.listen();
const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
const results:any[]=[];const blocked:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1200,height:1300},serviceWorkers:'block'});
 await page.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  // No document/network uploads: only local reads and the existing SDK's static assets.
  if(r.method()==='GET' && (u.origin===origin || u.origin===studio?.origin || !studio && u.origin==='https://edwardkim.github.io' && u.pathname.startsWith('/rhwp/') || u.origin==='https://fonts.gstatic.com' || u.origin==='https://cdn.jsdelivr.net' && /^\/gh\/projectnoonnu\/[\w@.]+\/\w+\.woff2?$/u.test(u.pathname)))return route.continue();
  blocked.push(u.origin+u.pathname);return route.abort();
 });
 await page.goto(origin+'/cf146-native.html');
 await page.evaluate(async()=>await (globalThis as any).cf146Ready);
 for(let index=0;index<files.length;index++){
  const relative=path.relative(sourceRoot,files[index]),id=relative.slice(0,2)+'-'+index;
  console.log('READ_ONLY_START',id,path.extname(files[index]),readFileSync(files[index]).length);
  const item:any={id,relativePath:relative,sha256:before[index]};
  try{
   const loaded=await page.evaluate(async({index,name})=>{
    const bytes=await(await fetch('/reference/'+index)).arrayBuffer();
    return await (globalThis as any).cf146Native.loadFile(bytes,name,{suppressDialogs:true});
   },{index,name:path.basename(files[index])});
   item.pageCount=loaded.pageCount;
   item.pages=[];
   const indices=process.env.CF146_ALL_PAGES === '1' ? Array.from({length:loaded.pageCount},(_,i)=>i) : [...new Set([0,1,Math.min(28,loaded.pageCount-1),loaded.pageCount-1])].filter(p=>p>=0&&p<loaded.pageCount);
   for(const n of indices){
    const svg=await page.evaluate(async n=>await (globalThis as any).cf146Native.getPageSvg(n),n);
    writeFileSync(path.join(output,id+'-page-'+(n+1)+'.svg'),svg);
    const check=await page.evaluate(async svg=>{
     const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
     const text=[...root.querySelectorAll('text')].map(n=>n.textContent).join(' ');
     const image=await (globalThis as any).cf146Image(svg,'reference.jpg');
     return {width:root.getAttribute('width'),height:root.getAttribute('height'),viewBox:root.getAttribute('viewBox'),images:root.querySelectorAll('image').length,textLength:text.length,jpeg:[...new Uint8Array(await image.arrayBuffer())]};
    },svg);
    const {jpeg,...summary}=check;writeFileSync(path.join(output,id+'-page-'+(n+1)+'.jpg'),new Uint8Array(jpeg));
    item.pages.push({page:n+1,...summary});
   }
   item.status='RENDERED_NOT_FIDELITY_APPROVED';
  }catch(error){item.status='FAILED';item.error=String(error).slice(0,500);}
  results.push(item);writeFileSync(path.join(output,'results.json'),JSON.stringify({studioUrl:studioUrl||'https://edwardkim.github.io/rhwp/',results,blocked,originalsUnchanged:files.every((f,i)=>sha(f)===before[i])},null,2));
  console.log('READ_ONLY_RESULT',id,item.status,item.pageCount,item.error||'');
 }
 if(results.some(item=>item.status==='FAILED') || !files.every((f,i)=>sha(f)===before[i]))process.exitCode=1;
}finally{await browser.close();await server.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});

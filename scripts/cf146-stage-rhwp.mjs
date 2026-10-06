// Run after the web build. Only audited runtime assets enter the development deployment.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,lstatSync,mkdtempSync,renameSync,rmSync} from 'node:fs';
import {resolve,join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const [distArg,engineArg,nativePkgArg]=process.argv.slice(2);
assert.ok(distArg && engineArg && nativePkgArg,'Pass the /rhwp/ Studio dist, pinned engine source directory (or --approved-snapshot) and matching native pkg directory');
const source=resolve(distArg),engine=resolve(engineArg),web=resolve(process.env.CF146_WEB_DIST || join(repo,'apps/web/dist')),target=join(web,'rhwp');
const snapshot=engineArg==='--approved-snapshot';
const sha=b=>createHash('sha256').update(b).digest('hex');
const approved=JSON.parse(readFileSync(join(repo,'scripts/fixtures/cf149-approved-runtime-manifest.json'),'utf8'));
assert.equal(sha(readFileSync(join(repo,'scripts/fixtures/cf149-approved-runtime-manifest.json'),'utf8').replace(/\r\n/g,'\n').trimEnd()),'452b06bd8aa4a4161a09f87fc5a54e6558bdab587179438f7ddb2410280fb5c3','Approved runtime manifest changed; independent approval required');
const expected='bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44';
const nativePkg=resolve(nativePkgArg);
assert.equal(sha(readFileSync(join(nativePkg,'rhwp_bg.wasm'))),expected);
assert.equal(sha(readFileSync(join(nativePkg,'rhwp.js'))),'ad01e939079e3518bc76c442bf395ab058a912991ccb54c8b0be7f5a9a760153');
// A matching binary must not be relabelled with different source provenance.
// Validate before copying any assets or rewriting runtime-config.js.
const cf149PatchSha256=sha(Buffer.concat(['cf149-hwpx-edited-axis.patch','cf149-rhwp-print-profile.patch'].map(f=>readFileSync(join(repo,'patches',f)))));
assert.equal(cf149PatchSha256,'acbea1510dbd408f605ba0b651f342829aa278d57a0862dd3c2a5570c7e1bea9','CF149 source patches do not match the approved runtime; staging stopped before writes');
assert.equal(sha(readFileSync(join(repo,'patches/cf146-rhwp-layout.patch'))),approved.patch,'Layout source patch changed; independent approval required');
assert.ok(existsSync(join(web,'index.html')),'Build web first');
assert.ok(!existsSync(target),'Fresh web build required; do not merge stale runtime files');
const assets=readdirSync(join(source,'assets'));
const wasm=assets.filter(f=>/^rhwp_bg-[\w-]+\.wasm$/.test(f));
assert.equal(wasm.length,1);
assert.equal(sha(readFileSync(join(source,'assets',wasm[0]))),expected);
let html=readFileSync(join(source,'index.html'),'utf8');
assert.ok(html.includes('src="/rhwp/assets/'),'Studio must be built with --base=/rhwp/');
// Embedded editor needs no offline worker. Avoid sample precache and application-wide interception.
html=html.replace(/<link rel="manifest"[^>]*>/g,'').replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g,'');
assert.ok(!html.includes('registerSW.js'));
const selected=['theme-init.js','favicon.ico','print.html',...assets.map(f=>'assets/'+f)];
for(const dir of ['icons','images'])for(const f of readdirSync(join(source,dir)))selected.push(dir+'/'+f);
// The Windows checkout stores public/fonts as a symlink text file. Copy only
// explicitly licensed fallback fonts from the pinned canonical source instead.
const fontFiles=['NotoSansKR-Regular.woff2','NotoSansKR-Bold.woff2','NotoSansKR-ExtraLight.woff2','NotoSerifKR-Regular.woff2','NotoSerifKR-Bold.woff2','SourceHanSerifK-OldHangul-subset.woff2'];
const extraFiles=fontFiles.map(f=>[join(snapshot?source:engine,snapshot?'fonts':'assets/fonts',f),'fonts/'+f]);
extraFiles.push([join(nativePkg,'rhwp.js'),'native/rhwp-ad01e939079e.js']);
extraFiles.push(
  [join(snapshot?source:engine,snapshot?'fonts':'ttfs/opensource','NotoSansKR-OFL.txt'),'fonts/NotoSansKR-OFL.txt'],
  [join(repo,'scripts/licenses/NotoSerifKR-OFL.txt'),'fonts/NotoSerifKR-OFL.txt'],
  [join(snapshot?source:engine,snapshot?'fonts':'assets/fonts','SourceHanSerifK-OFL.txt'),'fonts/SourceHanSerifK-OFL.txt'],
  [join(snapshot?source:engine,snapshot?'LICENSE-rhwp.txt':'LICENSE'),'LICENSE-rhwp.txt'],
  [join(snapshot?source:engine,'THIRD_PARTY_LICENSES.md'),'THIRD_PARTY_LICENSES.md'],
  [join(snapshot?source:engine,snapshot?'LICENSE-canvaskit.txt':'rhwp-studio/node_modules/canvaskit-wasm/LICENSE'),'LICENSE-canvaskit.txt'],
);
for(const [file] of extraFiles){
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  assert.ok(lstatSync(file).size<25*1024*1024);
  if(file.endsWith('.woff2'))assert.equal(readFileSync(file).subarray(0,4).toString(),'wOF2');
}
for(const f of selected){
  assert.ok(f==='print.html' || /\.(js|css|wasm|ico|png|svg)$/.test(f));
  assert.ok(lstatSync(join(source,f)).isFile() && !lstatSync(join(source,f)).isSymbolicLink());
  assert.ok(lstatSync(join(source,f)).size<25*1024*1024);
}
const config=join(web,'runtime-config.js');
const previous=readFileSync(config,'utf8');
assert.ok(!previous.includes('/* CF146_STAGED_RUNTIME */'));
// Compare every byte before writing anything. Re-hashing arbitrary inputs into
// a new manifest is not evidence that the Studio, fonts or licences are approved.
const contents=new Map(selected.map(f=>[f,readFileSync(join(source,f))]));
for(const [file,destination] of extraFiles){assert.ok(!contents.has(destination),'Duplicate runtime destination');contents.set(destination,readFileSync(file));}
contents.set('index.html',Buffer.from(html));
assert.deepEqual([...contents.keys()].sort(),approved.files.map(f=>f.path).sort(),'Runtime file set differs from the approved build');
for(const file of approved.files)assert.equal(sha(contents.get(file.path)),file.sha256,'Runtime asset differs from the approved build: '+file.path);
// Never leave a partial deployable runtime after a disk or permission failure.
const stagingRoot=mkdtempSync(join(web,'.rhwp-stage-'));
assert.equal(dirname(stagingRoot),web);
const preparedTarget=join(stagingRoot,'rhwp'),preparedConfig=join(stagingRoot,'runtime-config.js');
const nextConfig=previous+'\n/* CF146_STAGED_RUNTIME */\nwindow.__CLAIM_CENTER_RHWP_STUDIO_URL__ = new URL("/rhwp/", window.location.origin).href;\n';
let moved=false,committed=false;
try{
  mkdirSync(preparedTarget);
  for(const [destination,bytes] of contents){mkdirSync(dirname(join(preparedTarget,destination)),{recursive:true});writeFileSync(join(preparedTarget,destination),bytes);}
  const manifestBytes=JSON.stringify(approved,null,2);
  writeFileSync(join(preparedTarget,'build-manifest.json'),manifestBytes);
  writeFileSync(preparedConfig,nextConfig);
  for(const file of approved.files)assert.equal(sha(readFileSync(join(preparedTarget,file.path))),file.sha256,'Written runtime asset differs: '+file.path);
  assert.equal(readFileSync(join(preparedTarget,'build-manifest.json'),'utf8'),manifestBytes);
  assert.equal(readFileSync(preparedConfig,'utf8'),nextConfig,'Written runtime config differs');
  assert.equal(readFileSync(config,'utf8'),previous,'Runtime config changed during staging; do not overwrite it');
  assert.ok(!existsSync(target),'Runtime output appeared during staging; do not overwrite it');
  renameSync(preparedTarget,target);moved=true;
  renameSync(preparedConfig,config);committed=true;
}catch(error){
  if(moved){
    try{renameSync(target,preparedTarget);moved=false;}
    catch(rollbackError){throw new AggregateError([error,rollbackError],'Runtime staging rollback failed; do not deploy. Preserve '+target+' and '+stagingRoot+' for recovery.');}
  }
  throw error;
}finally{
  // If rollback itself fails, preserve the completed files and diagnostics.
  if(!moved||committed)rmSync(stagingRoot,{recursive:true,force:true});
}
console.log(JSON.stringify({staged:relative(repo,target),files:contents.size,wasm:expected,samplesIncluded:false,serviceWorker:false,sourceMode:snapshot?'verified-deployment-snapshot':'verified-source-build',engineRebuilt:false}));

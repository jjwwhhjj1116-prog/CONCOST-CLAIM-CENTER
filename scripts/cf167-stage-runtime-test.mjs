import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,copyFileSync,cpSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';

const repo=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(process.env.CF167_RUNTIME_SNAPSHOT||join(repo,'pinned-runtime/rhwp'));
const nativePkg=resolve(process.env.CF148_ENGINE_DIR||join(repo,'pinned-runtime/pkg'));
const approved=JSON.parse(readFileSync(join(repo,'scripts/fixtures/cf149-approved-runtime-manifest.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('runtime staging accepts only the entire approved snapshot before any writes',async t=>{
  const temporaryParent=resolve(process.env.CF167_TEMP_ROOT||join(repo,'tmp'));mkdirSync(temporaryParent,{recursive:true});
  const root=mkdtempSync(join(temporaryParent,'cf167-stage-'));
  assert.equal(dirname(root),resolve(temporaryParent));assert.ok(root.startsWith(join(temporaryParent,'cf167-stage-')));
  t.after(()=>rmSync(root,{recursive:true,force:true})); // Only this test-owned, resolved directory.
  for(const name of ['approved','external-output','studio-js','font','wasm','binding','patch','layout-patch','manifest','config','write-failure','config-commit-failure','rollback-failure'])await t.test(name,subtest=>{
    const candidate=join(root,name),studio=join(candidate,'studio'),pkg=join(candidate,'pkg'),web=join(candidate,name==='external-output'?'external-build':'apps/web/dist');
    // Release each isolated fixture before copying the next full runtime.
    assert.equal(dirname(candidate),root);
    subtest.after(()=>rmSync(candidate,{recursive:true,force:true}));
    mkdirSync(web,{recursive:true});mkdirSync(join(candidate,'scripts/fixtures'),{recursive:true});mkdirSync(join(candidate,'scripts/licenses'),{recursive:true});mkdirSync(join(candidate,'patches'),{recursive:true});
    cpSync(source,studio,{recursive:true});cpSync(nativePkg,pkg,{recursive:true});
    for(const file of ['scripts/cf146-stage-rhwp.mjs','scripts/fixtures/cf149-approved-runtime-manifest.json','scripts/licenses/NotoSerifKR-OFL.txt','patches/cf149-hwpx-edited-axis.patch','patches/cf149-rhwp-print-profile.patch','patches/cf146-rhwp-layout.patch'])copyFileSync(join(repo,file),join(candidate,file));
    writeFileSync(join(web,'index.html'),'<!doctype html><title>Application fixture</title>');
    const config=name==='config'?'/* CF146_STAGED_RUNTIME */':'window.unchangedFixture=true;';
    writeFileSync(join(web,'runtime-config.js'),config);
    const flip=file=>{const bytes=readFileSync(file);bytes[bytes.length-8]^=1;writeFileSync(file,bytes);};
    if(name==='studio-js')flip(join(studio,approved.files.find(f=>/^assets\/index-.*\.js$/.test(f.path)).path));
    if(name==='font')flip(join(studio,'fonts/NotoSerifKR-Regular.woff2'));
    if(name==='wasm')flip(join(pkg,'rhwp_bg.wasm'));
    if(name==='binding')flip(join(pkg,'rhwp.js'));
    if(name==='patch')flip(join(candidate,'patches/cf149-hwpx-edited-axis.patch'));
    if(name==='layout-patch')flip(join(candidate,'patches/cf146-rhwp-layout.patch'));
    if(name==='manifest'){
      const file=join(candidate,'scripts/fixtures/cf149-approved-runtime-manifest.json');
      const changed=JSON.parse(readFileSync(file,'utf8'));changed.upstream='0'+changed.upstream.slice(1);
      writeFileSync(file,JSON.stringify(changed,null,2));
    }
    const hook=join(candidate,'write-failure.cjs'),args=[];
    if(name==='write-failure'||name==='config-commit-failure'||name==='rollback-failure'){
      // Inject a filesystem fault in this child only, never the user's filesystem.
      writeFileSync(hook,`const fs=require('node:fs');const {syncBuiltinESMExports}=require('node:module');
const write=fs.writeFileSync,rename=fs.renameSync;let writes=0;
fs.writeFileSync=(...args)=>{if(${JSON.stringify(name)}==='write-failure'&&++writes===2)throw Error('CF167 simulated asset write failure');return write(...args);};
fs.renameSync=(...args)=>{if(['config-commit-failure','rollback-failure'].includes(${JSON.stringify(name)})&&String(args[1]).endsWith('runtime-config.js'))throw Error('CF167 simulated config commit failure');if(${JSON.stringify(name)}==='rollback-failure'&&String(args[0])===${JSON.stringify(join(web,'rhwp'))})throw Error('CF167 simulated rollback failure');return rename(...args);};
syncBuiltinESMExports();`);
      args.push('--require',hook);
    }
    const result=spawnSync(process.execPath,[...args,join(candidate,'scripts/cf146-stage-rhwp.mjs'),studio,'--approved-snapshot',pkg],{encoding:'utf8',timeout:20000,env:{...process.env,CF146_WEB_DIST:name==='external-output'?web:''}});
    assert.ifError(result.error);
    if(name==='approved'||name==='external-output'){
      assert.equal(result.status,0,result.stderr);
      const staged=join(web,'rhwp');
      for(const file of approved.files)assert.equal(sha(readFileSync(join(staged,file.path))),file.sha256,file.path);
      assert.equal(sha(readFileSync(join(staged,'build-manifest.json'))),'452b06bd8aa4a4161a09f87fc5a54e6558bdab587179438f7ddb2410280fb5c3');
      assert.match(readFileSync(join(web,'runtime-config.js'),'utf8'),/CF146_STAGED_RUNTIME/);
      const output=JSON.parse(result.stdout);
      assert.equal(output.sourceMode,'verified-deployment-snapshot');
      assert.equal(output.files,28);assert.equal(output.engineRebuilt,false);assert.equal(output.wasm,approved.wasm);
    }else{
      assert.notEqual(result.status,0,'Changed '+name+' must fail');
      assert.equal(result.stdout.trim(),'','A failed stage must not report success');
      if(name==='studio-js')assert.match(result.stderr,/Runtime asset differs.*assets\/index-/);
      if(name==='font')assert.match(result.stderr,/Runtime asset differs.*fonts\/NotoSerifKR-Regular/);
      if(name==='patch')assert.match(result.stderr,/CF149 source patches/);
      if(name==='layout-patch')assert.match(result.stderr,/Layout source patch changed/);
      if(name==='manifest')assert.match(result.stderr,/Approved runtime manifest changed/);
      if(name==='wasm')assert.match(result.stderr,/bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44/);
      if(name==='binding')assert.match(result.stderr,/ad01e939079e3518bc76c442bf395ab058a912991ccb54c8b0be7f5a9a760153/);
      if(name==='config')assert.match(result.stderr,/CF146_STAGED_RUNTIME/);
      if(name==='write-failure')assert.match(result.stderr,/CF167 simulated asset write failure/);
      if(name==='config-commit-failure')assert.match(result.stderr,/CF167 simulated config commit failure/);
      if(name==='rollback-failure'){
        assert.match(result.stderr,/Runtime staging rollback failed; do not deploy/);
        assert.match(result.stderr,/CF167 simulated config commit failure/);assert.match(result.stderr,/CF167 simulated rollback failure/);
        for(const file of approved.files)assert.equal(sha(readFileSync(join(web,'rhwp',file.path))),file.sha256,'Preserved recovery files must still be complete');
      }else assert.equal(existsSync(join(web,'rhwp')),false,'Failure must not leave deployable runtime output');
      assert.equal(readFileSync(join(web,'runtime-config.js'),'utf8'),config,'Failure must preserve application runtime config');
    }
    const preserved=readdirSync(web).filter(file=>file.startsWith('.rhwp-stage-'));
    if(name==='rollback-failure'){
      assert.equal(preserved.length,1,'Double filesystem failure preserves the recovery directory');
      assert.equal(readFileSync(join(web,preserved[0],'runtime-config.js'),'utf8'),config+'\n/* CF146_STAGED_RUNTIME */\nwindow.__CLAIM_CENTER_RHWP_STUDIO_URL__ = new URL("/rhwp/", window.location.origin).href;\n','Prepared config must be preserved intact for explicit recovery');
    }
    else assert.deepEqual(preserved,[],'A failed stage must clean up only its own temporary directory');
  });
});

test('deployment commands cannot rebuild away the verified HWP runtime',()=>{
  const scripts=JSON.parse(readFileSync(join(repo,'package.json'),'utf8')).scripts;
  assert.match(scripts['cf:build'],/build && corepack pnpm cf:stage:rhwp:snapshot$/);
  for(const name of ['cf:upload','cf:upload:gaopen','cf:deploy','cf:deploy:gaopen','cf:deploy:development'])assert.ok(scripts[name].includes('corepack pnpm cf:build && wrangler'),name+' must wait for both build and verified runtime staging');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('CF150 actual library file reselect rotates only a confirmed FAILED request key', async () => {
  const baseStyles = readFileSync(resolve('apps/web/index.html'), 'utf8').match(/<style>[\s\S]*?<\/style>/g)?.join('') ?? '';
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf150-upload-retry',
    configureServer(server) { server.middlewares.use(async (req, res, next) => {
      if (req.url === '/cf150-stalled-body') {
        res.setHeader('Content-Type', 'application/json'); res.write('{"result":'); return;
      }
      if (req.url?.split('?')[0] !== '/cf150-upload-retry.html') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, `<!doctype html><html lang="ko" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${baseStyles}</head><body><div id="root"></div><script>window.__CLAIM_API_ORIGIN__=location.origin</script><script type="module" src="/cf150-upload-retry.js"></script></body></html>`));
    }); },
    resolveId: id => id === '/cf150-upload-retry.js' ? '\0cf150-upload-retry' : undefined,
    load: id => id === '\0cf150-upload-retry' ? `import React from 'react';import{createRoot}from'react-dom/client';import{CaseEvidencePanel}from'/src/evidence/CaseEvidencePanel.tsx';import{PreviewGoogleDriveSetup}from'/src/routes/PreviewEvidenceHub.tsx';import'/src/evidence/CaseEvidencePanel.css';import'/src/preview-theme.css';import'/src/theme-system.css';import'/src/routes/PreviewSettings.css';window.__CLAIM_API_ORIGIN__=location.origin;const setup=location.search.includes('setup');createRoot(document.getElementById('root')).render(setup?React.createElement('div',{className:'preview-settings'},React.createElement(PreviewGoogleDriveSetup,{onNavigate:()=>{}})):React.createElement(CaseEvidencePanel,{caseId:'40000000-0000-4000-8000-000000000010',defaultCategory:'REPORT_REFERENCE',allowedCategories:['REPORT_REFERENCE'],onNavigate:()=>{}}));` : undefined
  }] });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const deadlinePage = await browser.newPage();
    await deadlinePage.goto(origin + '/cf150-upload-retry.html');
    const deadline = await deadlinePage.evaluate(async () => {
      const path = '/src/api.ts'; const { apiRequest } = await import(path);
      return Promise.race([
        apiRequest('/cf150-stalled-body', { timeoutMs: 80 }).then(() => 'incorrect success', (e: { payload?: { code?: string } }) => e.payload?.code ?? 'incorrect error'),
        new Promise<string>(resolve => setTimeout(() => resolve('body deadline missing'), 500))
      ]);
    });
    assert.equal(deadline, 'CLIENT_REQUEST_TIMEOUT', 'headers must not clear the JSON body deadline');
    await deadlinePage.close();
    for (const width of [1440, 390]) for (const mode of ['failed', 'manual-approved', 'uncertain', 'status-unknown', 'network', 'json', 'missing-file', 'read-failure'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const keys: string[] = []; const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() === 'GET') {
          if(mode==='read-failure' && keys.length) return route.abort();
          return route.fulfill({ json: { files: [], storageChecks: mode === 'manual-approved' ? [{id:'synthetic-old-op',category:'REPORT_REFERENCE',errorCode:'GOOGLE_TIMEOUT',createdAt:'2026-09-30',manualRetryAuthorized:true,manualRetryAllowed:true,replacementStatus:null}] : [], storagePolicy: 'GOOGLE_DRIVE_REQUIRED', googleDriveConnected: true } });
        }
        keys.push(request.headers()['idempotency-key']);
        if (mode === 'network') return route.abort('failed');
        if (mode === 'json') return route.fulfill({status:200,body:'invalid json'});
        if (mode === 'missing-file') return route.fulfill({status:200,json:{}});
        return route.fulfill({ status: mode === 'manual-approved' ? 409 : mode === 'failed' ? 504 : 503, json: { error: '합성 업로드 실패', code: mode === 'manual-approved' ? 'UPLOAD_MANUAL_RETRY_REQUIRED' : mode === 'failed' ? 'GOOGLE_TIMEOUT' : mode === 'uncertain' ? 'RECONCILIATION_REQUIRED' : 'UPLOAD_STATUS_CHECK_REQUIRED', ...(['failed','manual-approved'].includes(mode) ? { retryable: true } : {}) } });
      });
      await page.goto(origin + '/cf150-upload-retry.html');
      const input = page.locator('input[type="file"]');
      await page.getByText('회사 계정 연결 완료', { exact: false }).waitFor();
      const canRetry=['failed','manual-approved'].includes(mode);
      for (let attempt = 1; attempt <= (canRetry?2:1); attempt++) {
        await input.setInputFiles([{name:'cf150-upload.txt',mimeType:'text/plain',buffer:readFileSync(resolve('scripts/fixtures/cf150-upload.txt'))},{name:'never-send.txt',mimeType:'text/plain',buffer:Buffer.from('second synthetic file')}]);
        await page.getByRole('alert').waitFor();
        await page.getByRole('button', { name: '파일 선택', exact: true }).waitFor();
        await page.waitForFunction((canRetry) => {
          const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
          return fileInput?.value === '' && fileInput.disabled===!canRetry;
        },canRetry);
        assert.equal(keys.length, attempt, `${width}/${mode}: no automatic POST retries`);
      }
      if(canRetry)assert.notEqual(keys[0],keys[1],`${width}/${mode}: confirmed failure permits fresh key`);
      else {
        await page.getByRole('button',{name:'다시 확인',exact:true}).click();
        await page.waitForFunction(()=>!document.body.textContent?.includes('자료와 저장 폴더명을 불러오는 중입니다.'));
        assert.equal(await input.isDisabled(),true,'read success or failure must not unlock an unknown POST');
        await page.evaluate(()=>{
          for(const selector of ['.case-evidence-dropzone','[role="tab"]']){
            const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['renamed'],'renamed.txt',{type:'text/plain'}));
            document.querySelector(selector)!.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
          }
        });
        assert.equal(keys.length,1,'first failure stops the batch');
      }
      if(canRetry)assert.equal(await page.getByRole('alert').innerText().then(text => text.includes('새 시도로 저장')), true);
      if(mode==='manual-approved') {
        assert.equal(await page.getByText('관리자 수동 재시도 1회 승인', {exact:false}).count(),1);
        assert.equal(await page.locator('.case-evidence-panel').evaluate(el => el.scrollWidth > el.clientWidth + 1),false,`${width}: manual consent must not overflow`);
        await page.screenshot({path:resolve(`tmp/cf151-manual-retry-${width}.png`),fullPage:true});
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const page=await browser.newPage();let writes=0;
      const stored={id:'synthetic-file',category:'REPORT_REFERENCE',originalName:'first.txt',byteSize:5,mimeType:'text/plain',storageProvider:'GOOGLE_DRIVE',uploadedAt:'2026-10-01',uploadedBy:'시험',folder:{key:'test',name:'시험'}};
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
        if(req.method()==='GET')return route.fulfill({json:{files:writes?[stored]:[],storageChecks:[],storagePolicy:'GOOGLE_DRIVE_REQUIRED',googleDriveConnected:true}});
        writes++;return route.fulfill({status:writes===1?200:503,json:writes===1?{file:stored}:{code:'RECONCILIATION_REQUIRED',error:'합성 저장 미확정'}});
      });
      await page.goto(origin+'/cf150-upload-retry.html');await page.getByText('회사 계정 연결 완료',{exact:false}).waitFor();
      await page.locator('input[type="file"]').setInputFiles(['first','second','third'].map(name=>({name:name+'.txt',mimeType:'text/plain',buffer:Buffer.from('hello')})));
      await page.getByRole('status').filter({hasText:'파일 1개'}).waitFor();
      assert.equal(writes,2);assert.equal(await page.locator('input[type="file"]').isDisabled(),true);
      assert.equal(await page.getByText('저장 중…',{exact:false}).count(),0);
      assert.equal(await page.getByText('first.txt',{exact:true}).count(),1);
      await page.close();
    }
    for(const width of [1440,390]) for(const mode of ['expired','consumed','other-hold'] as const) {
      const page=await browser.newPage({viewport:{width,height:1000}});let writes=0;const errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
        if(req.method()!=='GET'){writes++;return route.abort();}
        const checks=[{id:'synthetic-old-op',category:'REPORT_REFERENCE',errorCode:'GOOGLE_TIMEOUT',createdAt:'2026-09-30',manualRetryAuthorized:true,manualRetryAllowed:mode==='other-hold',replacementStatus:mode==='consumed'?'RECONCILIATION_REQUIRED':null},...(mode==='other-hold'?[{id:'synthetic-second-hold',category:'REPORT_REFERENCE',errorCode:'GOOGLE_TIMEOUT',createdAt:'2026-09-30'}]:[])];
        return route.fulfill({json:{files:[],storageChecks:checks,storagePolicy:'GOOGLE_DRIVE_REQUIRED',googleDriveConnected:true}});
      });
      await page.goto(origin+'/cf150-upload-retry.html');await page.getByText('회사 계정 연결 완료',{exact:false}).waitFor();
      assert.equal(await page.locator('input[type="file"]').isDisabled(),true,`${width}/${mode}: no broad category unlock`);
      assert.equal(writes,0);assert.deepEqual(errors,[]);await page.close();
    }
    for (const width of [1440, 390]) for (const mode of ['timeout', 'reconsent', 'network'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = []; let reads = 0; let writes = 0;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') { writes++; return route.abort(); }
        if (url.pathname === '/api/google/oauth-app') return route.fulfill({ json: { configured: true, source: 'CLOUDFLARE_SECRET', allowedDomain: 'con-cost.com', clientIdHint: 'synthetic', redirectUri: 'https://example.invalid/api/google/oauth/callback', version: 0 } });
        reads++;
        if (reads === 1 || reads === 3) return route.fulfill({ json: { connected: true, configured: true, accountEmail: 'synthetic@example.invalid', verification: { status: 'VERIFIED', stage: null, code: null } } });
        if (mode === 'network') return route.abort();
        return route.fulfill({ json: { connected: true, configured: true, accountEmail: null, verification: { status: 'FAILED', stage: mode === 'timeout' ? 'DRIVE_ACCOUNT' : 'TOKEN_REFRESH', code: mode === 'timeout' ? 'GOOGLE_TIMEOUT' : 'GOOGLE_RECONSENT_REQUIRED' } } });
      });
      await page.goto(origin + '/cf150-upload-retry.html?setup');
      const status = page.getByRole('status');
      await status.filter({ hasText: 'CONNECTED' }).waitFor();
      await page.getByRole('button', { name: '연결 상태 다시 확인', exact: true }).click();
      await status.filter({ hasText: mode === 'network' ? '상태 확인 실패' : '조회 실패' }).waitFor();
      assert.equal((await status.innerText()).includes('CONNECTED'), false);
      assert.equal(await page.locator('.is-connected').count(), 0);
      if (mode !== 'network') {
        const message = await page.getByRole('alert').innerText();
        assert.ok(message.includes(mode === 'timeout' ? 'Drive 계정 조회 실패 · GOOGLE_TIMEOUT' : 'Google 인증 갱신 실패 · GOOGLE_RECONSENT_REQUIRED'));
        assert.ok(message.includes(mode === 'timeout' ? '보류된 업로드가 복구되지는 않습니다' : '스튜디오 재로그인은 필요 없습니다'));
        const colors = await page.getByRole('alert').evaluate(el => {
          const style = getComputedStyle(el);
          return { text: style.color, background: style.backgroundColor };
        });
        const luminance = (color: string) => {
          const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const text = luminance(colors.text), background = luminance(colors.background);
        const contrast = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
        assert.ok(contrast >= 4.5, `${width}/${mode}: error text contrast ${contrast}`);
      }
      const overflow = await page.evaluate(() => {
        const el = document.querySelector('.preview-drive-setup')!;
        return el.scrollWidth > el.clientWidth + 1;
      });
      assert.equal(overflow, false, `${width}/${mode}: no horizontal overflow`);
      if (mode === 'timeout') await page.screenshot({ path: resolve(`tmp/cf150-drive-status-failed-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: '연결 상태 다시 확인', exact: true }).click();
      await status.filter({ hasText: 'CONNECTED' }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0); assert.equal(reads, 3); assert.equal(writes, 0); assert.deepEqual(errors, []);
      await page.close();
    }
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }); let writes = 0; let checks = 0;
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') { writes++; return route.abort(); }
        if (url.pathname.endsWith('/storage-check')) { checks++; return route.fulfill({ json: { status: 'UNKNOWN', readOnly: true, reasonCode: 'EMPTY_SCOPED_SEARCH', stage: 'CANDIDATE_SEARCH', message: '저장 여부를 확정하지 못했습니다. 파일과 원고를 보존하며 재업로드는 차단됩니다.' } }); }
        return route.fulfill({ json: { files: [], storageChecks: [{ id: '40000000-0000-4000-8000-000000000011', category: 'REPORT_REFERENCE' }], storagePolicy: 'GOOGLE_DRIVE_REQUIRED', googleDriveConnected: true } });
      });
      await page.goto(origin + '/cf150-upload-retry.html');
      await page.getByRole('button', { name: 'Drive 저장 결과 확인', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '파일 미저장이 확인된 것은 아닙니다.' }).waitFor();
      assert.equal(await page.locator('input[type="file"]').isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '파일 선택', exact: true }).isDisabled(), true);
      assert.equal(checks, 1); assert.equal(writes, 0); assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
});

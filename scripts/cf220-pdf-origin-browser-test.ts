import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

test('CF220 report PDF dots, text, table and photo stay exact inside a scrolling output dialog at different origins', async () => {
  const deps = process.env.CF212_BUNDLED_DEPENDENCIES;
  assert.ok(deps, 'Set CF212_BUNDLED_DEPENDENCIES to the bundled runtime');
  const base = resolve('tmp/cf220-qa'); mkdirSync(base, { recursive: true });
  const output = mkdtempSync(join(base, 'pdf-origin-'));
  const before = process.env.CF220_BEFORE_CAPTURE_ORIGIN === '1';
  const source = readFileSync('apps/web/src/documents/final-document-export.ts', 'utf8');
  const originPatch = /        if \(report\) \{\r?\n          clonedPage\.style\.position = 'fixed';\r?\n          clonedPage\.style\.left = '0';\r?\n          clonedPage\.style\.top = '0';\r?\n        \}/u;
  assert.equal(source.match(originPatch)?.[0] !== undefined, true);
  const entry = `import '/src/theme-system.css';import '/src/documents/DocumentReviewWorkspace.css';import {downloadFinalDocument} from '/src/documents/final-document-export.ts';
    const q=new URLSearchParams(location.search);document.body.style.cssText='margin:0;background:white';
    const spacer=document.createElement('div');spacer.style.height=q.get('y')+'px';document.getElementById('root').before(spacer);
    const host=document.getElementById('root');host.style.cssText='overflow:auto;max-height:520px;width:1100px';host.className='working-copy-output';
    const root=document.createElement('div');root.className='report-final-document';root.dataset.exportDocumentKind='REPORT';root.style.cssText='position:relative;width:794px;margin:0;padding:0;left:'+q.get('x')+'px';host.append(root);
    const titles=['검토결론 요약 — 목차 편집 검수','의뢰·프로젝트 및 조사 개요','기준자료·판단기준 및 자료한계','현장조사 계획·방법 및 신뢰도','현장조사 결과','수량산출 및 시공상태 분류','보수비·공사비·기성금액 산정','쟁점·공종별 상세 검토','종합결론 및 실행 권고','부록·증거목록','합성 현장 사진·산출 근거'];
    root.innerHTML='<article data-export-page data-export-page-policy="fit" style="box-sizing:border-box;width:794px;height:1123px;min-height:1123px;margin:0;padding:76px;background:white;color:#111;font:16px/1.8 Batang,serif"><h2 style="text-align:center">목 차</h2>'+titles.map((title,i)=>'<div class="report-toc-entry"><span>'+(i+1)+'. '+title+'</span><span class="report-toc-leader"></span><span class="report-toc-page">'+(i<6?1:2)+'</span></div>').join('')+'<table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #123">123.45</td><td style="border:1px solid #123">246.9</td></tr><tr><td style="border:1px solid #123"></td><td style="border:1px solid #123">0</td></tr></table><img alt="합성 사진" style="width:160px;height:80px;object-fit:contain;margin-top:24px"></article>';
    const picture=document.createElement('canvas');picture.width=160;picture.height=80;const ctx=picture.getContext('2d');ctx.fillStyle='#148abb';ctx.fillRect(0,0,160,80);ctx.fillStyle='#ef9b32';ctx.fillRect(20,10,60,50);root.querySelector('img').src=picture.toDataURL();await root.querySelector('img').decode();await document.fonts.ready;
    window.cf220Ready=true;window.cf220Export=()=>downloadFinalDocument({root,format:'pdf',fileName:'CF220-origin',orientation:'portrait',purpose:'DRAFT'});`;
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), cacheDir: join(output, 'cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
    name: 'cf220-output-origin-fixture', enforce: 'pre',
    configureServer(s) { s.middlewares.use(async (req, res, next) => { if (!(req.url || '').startsWith('/cf220.html')) return next(); const html = readFileSync('apps/web/index.html', 'utf8').replace('<script src="/runtime-config.js"></script>', '').replace('src="/src/main.tsx"', 'src="/cf220-entry.js"'); res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(req.url!, html)); }); },
    resolveId: id => id === '/cf220-entry.js' ? id : undefined,
    load: id => id === '/cf220-entry.js' ? entry : undefined,
    transform(code, id) { if (!before || !id.endsWith('/final-document-export.ts')) return null; assert.equal(originPatch.test(code), true); return code.replace(originPatch, ''); }
  }] });
  const receipts: unknown[] = [];
  try {
    await server.listen(); const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
    const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p)); assert.ok(executablePath);
    for (const [i, [x, y]] of [[.25, .25], [245.734375, 67.984375]].entries()) {
      const profile = mkdtempSync(join(output, 'profile-')); mkdirSync(join(profile, 'Default')); writeFileSync(join(profile, 'Default/Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2 / 3) / Math.log(1.2) } } }));
      const context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: null, args: ['--window-size=1440,1000'] });
      try {
        const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
        await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; const original = HTMLCanvasElement.prototype.toBlob; (window as any).cf220Raw = []; HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) { if (type === 'image/jpeg' && this.width > 900 && this.height > 1300) (window as any).cf220Raw.push(this.toDataURL('image/png')); return original.call(this, callback, type, quality); }; });
        await page.goto(origin + `/cf220.html?x=${x}&y=${y}`); await page.waitForFunction('window.cf220Ready===true');
        const observation = await page.evaluate(() => ({ html: document.querySelector('.report-final-document')!.innerHTML, dpr: devicePixelRatio, fontStatus: document.fonts.status, overflow: document.getElementById('root')!.scrollHeight > document.getElementById('root')!.clientHeight }));
        assert.equal(observation.dpr, .6666666865348816); assert.equal(observation.fontStatus, 'loaded'); assert.equal(observation.overflow, true);
        const download = page.waitForEvent('download'); await page.evaluate('window.cf220Export()'); await (await download).saveAs(join(output, `output-${i}.pdf`));
        const raw = await page.evaluate<string[]>('window.cf220Raw'); assert.equal(raw.length, 1); writeFileSync(join(output, `raw-${i}.png`), Buffer.from(raw[0].split(',')[1], 'base64'));
        assert.equal(await page.locator('.report-final-document').innerHTML(), observation.html); assert.deepEqual(errors, []); receipts.push(observation);
      } finally { await context.close(); }
      execFileSync(join(deps, 'native/poppler/Library/bin/pdftoppm.exe'), ['-png', '-r', '120', join(output, `output-${i}.pdf`), join(output, `render-${i}`)], { windowsHide: true });
    }
    const py = "from PIL import Image,ImageChops\nimport sys,json\nr=[]\nfor names in [('raw-0.png','raw-1.png'),('render-0-1.png','render-1-1.png')]:\n a=Image.open(sys.argv[1]+'/'+names[0]).convert('RGBA');b=Image.open(sys.argv[1]+'/'+names[1]).convert('RGBA');assert a.size==b.size\n d=ImageChops.difference(a,b);m=d.getchannel(0)\n for c in d.split()[1:]:m=ImageChops.lighter(m,c)\n r.append({'files':names,'size':a.size,'changedPixels':sum(m.histogram()[1:]),'bounds':m.getbbox(),'rgbaExact':a.tobytes()==b.tobytes()})\nprint(json.dumps(r))";
    const pixels = JSON.parse(execFileSync(join(deps, 'python/python.exe'), ['-B', '-c', py, output], { encoding: 'utf8', windowsHide: true }));
    writeFileSync(join(output, 'result.json'), JSON.stringify({ before, output, receipts, pixels }, null, 2)); console.log(JSON.stringify({ before, output, pixels }));
    assert.equal(pixels.every((row: { rgbaExact: boolean }) => row.rgbaExact), true, 'No pixel tolerance, cropped leaders or resized comparison');
  } finally { await server.close(); }
});

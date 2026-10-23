import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createServer } from '../apps/web/qa/vite-server.js';
const hash = (b: any) => createHash('sha256').update(b).digest('hex');
async function main() { const out = mkdtempSync(join(tmpdir(), 'claim-cf252-flow-')); const files = ['native-hwp-pages.ts', 'editable-hwp-export.ts', 'native-hwp-flow-lines.ts', 'native-hwp-line-cache.ts', 'positioned-hwp-export.ts', 'native-hwp-flow-advances.ts', 'native-hwp-paragraph-advances.ts', 'native-hwp-heading-ink.ts'].filter(n => existsSync('apps/web/src/documents/' + n)); const hashes = Object.fromEntries(files.map(n => [n, hash(readFileSync('apps/web/src/documents/' + n))])); const before = process.env.CF252_BEFORE_DIR; const server = await createServer({ root: resolve('apps/web'), cacheDir: join(out, 'cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{ name: 'private-before', enforce: 'pre', transform(code, id) { const name = id.replaceAll('\\', '/').split('?')[0].split('/').pop()!; if (before && files.includes(name) && existsSync(join(before, name)))
                return readFileSync(join(before, name), 'utf8'); } }] }); await server.listen(); const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as any).port; const browser = await chromium.launch({ executablePath: [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p)), headless: true }); try {
    const page = await browser.newPage();
    await page.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin !== origin)
        return route.abort(); if (u.pathname === '/qa')
        return route.fulfill({ contentType: 'text/html', body: '<html><head><script type="module">import "/src/theme-system.css";import "/src/documents/DocumentReviewWorkspace.css";window.__qaCssReady=true;</script></head><body></body></html>' }); if (u.pathname.startsWith('/rhwp/')) {
        const file = resolve('pinned-runtime/rhwp', u.pathname.slice(6));
        return route.fulfill({ body: readFileSync(file), contentType: file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
    } return route.continue(); });
    await page.goto(origin + '/qa');
    await page.waitForFunction(() => (window as any).__qaCssReady === true);
    await page.evaluate('globalThis.__name=x=>x');
    const source = await page.evaluate(async () => { const root = document.createElement('article'); root.className = 'report-final-document'; root.innerHTML = `<section data-export-page style="position:relative;box-sizing:border-box;width:794px;height:1123px;padding:40px;color:#111;background:#fff;font:12px/18.6px Arial"><article style="display:flow-root"><p data-key="body" style="margin:17.4px 0 16px;width:280px">첫문단 여러줄 위치 검수 Alpha Beta Gamma Delta Epsilon Zeta Eta Theta 종료</p><table style="width:480px;border-collapse:collapse;table-layout:fixed"><tr><td style="width:160px;padding:10px;text-align:left"><p data-key="left" style="margin:0">왼쪽 A123</p></td><td style="width:160px;padding:10px;text-align:center"><p data-key="center" style="margin:0">중앙 B234</p></td><td style="width:160px;padding:10px;text-align:right"><p data-key="right" style="margin:0">오른쪽 C345</p></td></tr></table><table style="width:264px;border-collapse:collapse;table-layout:fixed;margin-top:15px"><tr><td style="width:24px;padding:10px;text-align:center"><p data-key="narrow" style="margin:0">가나다</p></td><td style="width:240px;padding:10px"><p data-key="mixed" style="margin:0">혼합 <code style="font-family:GulimChe">CODE_12</code> 한글 보존 </p></td></tr></table><p data-key="space" style="margin:16px 0 0;width:140px">줄끝 공백 검수 단어 여러 개 마지막   </p><h2 data-key="heading" style="font:700 16px/22px Arial;margin:15px 0 7px">제목 Heading Q7</h2><ol start="3" style="margin:8px 0;padding-left:36px;list-style-type:decimal"><li style="margin:0;width:230px"><span data-key="ordered" data-marker="3.">순서 목록 Alpha 여러 단어로 이어지는 원본 줄 끝 확인</span><ul style="margin:4px 0;padding-left:28px;list-style-type:disc"><li style="margin:0;width:180px"><span data-key="nested" data-marker="•">중첩 목록 Beta 원문 보존</span></li></ul></li><li value="7" style="margin:0"><span data-key="ordered-seven" data-marker="7.">직접 번호 지정 Gamma</span></li></ol><p data-key="breaks" style="margin:10px 0;width:220px;white-space:normal">명시 줄바꿈 A<br>다음    연속 공백 B<br>마지막 C</p><p data-key="pre-spaces" style="margin:8px 0;white-space:pre-wrap;width:240px">보존   세칸 공백 D   끝</p><blockquote style="margin:10px 0 0 24px;padding:0 0 0 12px;border-left:2px solid #444"><p data-key="quote" style="margin:0;width:260px">인용문 Quote 문장과 위치를 유지합니다.</p></blockquote></article></section>`; document.body.append(root); await document.fonts.ready; const before = root.outerHTML, paper = root.querySelector('section')!.getBoundingClientRect(); const glyphs: any[] = []; for (const p of root.querySelectorAll<HTMLElement>('[data-key]')) {
        const original = p.innerHTML;
        if (p.dataset.marker)
            for (const char of p.dataset.marker)
                glyphs.push({ key: p.dataset.key, offset: -1, char, marker: true, x: null, y: null });
        const len = p.textContent!.length;
        for (let offset = 0; offset < len; offset++) {
            const find = () => { const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n: any, at = 0; while (n = w.nextNode()) {
                if (at + n.textContent.length > offset)
                    return { n, index: offset - at };
                at += n.textContent.length;
            } throw Error('OFFSET'); };
            let q = find();
            const char = q.n.textContent[q.index];
            if (!char.trim())
                continue;
            const r = document.createRange();
            r.setStart(q.n, q.index);
            r.setEnd(q.n, q.index + 1);
            const b = r.getBoundingClientRect();
            const ctx = document.createElement('canvas').getContext('2d')!;
            ctx.font = getComputedStyle(q.n.parentElement).font;
            const ascent = ctx.measureText(char).fontBoundingBoxAscent;
            glyphs.push({ key: p.dataset.key, offset, char, x: b.left - paper.left, y: b.top - paper.top + ascent, width: b.width, rangeTop: b.top - paper.top, ascent });
        }
        p.innerHTML = original;
    } if (root.outerHTML !== before)
        throw Error('DOM_MUTATED'); (window as any).sourceRoot = root; return { html: before, glyphs, markers: [...root.querySelectorAll('li')].map(li => { const c = getComputedStyle(li, '::marker'); return { type: getComputedStyle(li).listStyleType, position: getComputedStyle(li).listStylePosition, content: c.content, font: c.font, elementBox: li.getBoundingClientRect().toJSON(), rangeBoxAvailable: false }; }), paragraphs: [...root.querySelectorAll<HTMLElement>('[data-key]')].map(p => ({ key: p.dataset.key, text: p.textContent, brs: p.querySelectorAll('br').length, whiteSpace: getComputedStyle(p).whiteSpace, font: getComputedStyle(p).font })) }; });
    writeFileSync(join(out, 'source.json'), JSON.stringify(source));
    const invalidRejected = await page.evaluate(async () => { const { collectNativeHwpPages } = await import('/src/documents/native-hwp-pages.ts' as string); const { createNativeHwp } = await import('/src/documents/editable-hwp-export.ts' as string); const { loadNativeHwpEngine } = await import('/src/documents/native-hwp-runtime.ts' as string); const root = (window as any).sourceRoot, before = root.outerHTML, pages = await collectNativeHwpPages(root, 'portrait'), Engine = await loadNativeHwpEngine(); pages[0].flowLines![0].paint!.origins[0].x = NaN; let rejected = false; try {
        createNativeHwp(pages, Engine);
    }
    catch (e) {
        rejected = String(e).includes('좌표가 유효하지 않습니다');
    } if (root.outerHTML !== before)
        throw Error('SOURCE_CHANGED_ON_FAILURE'); return rejected; });
    assert.equal(invalidRejected, true, 'Nonfinite source coordinates must fail closed');
    const download = page.waitForEvent('download', { timeout: 120000 });
    download.catch(() => { });
    const result = await page.evaluate(async () => { const { downloadFinalDocument } = await import('/src/documents/final-document-export.ts' as string); return downloadFinalDocument({ root: (window as any).sourceRoot, format: 'hwp', fileName: 'CF252-small-flow', orientation: 'portrait' }); });
    const d = await download;
    await d.saveAs(join(out, 'actual.hwp'));
    const proof = await page.evaluate(async (bytes) => { const { loadNativeHwpEngine } = await import('/src/documents/native-hwp-runtime.ts' as string); const Engine = await loadNativeHwpEngine(), doc = new Engine(new Uint8Array(bytes)); try {
        const svg = doc.renderPageSvgWithProfile(0, 'print'), xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
        return { pages: doc.pageCount(), svg, text: [...xml.querySelectorAll('text')].filter(e => e.textContent?.trim()).map(e => ({ text: e.textContent, x: Number(e.getAttribute('x')), y: Number(e.getAttribute('y')) })), layout: JSON.parse(doc.getPageTextLayout(0)) };
    }
    finally {
        doc.free();
    } }, [...readFileSync(join(out, 'actual.hwp'))]);
    writeFileSync(join(out, 'native.json'), JSON.stringify(proof));
    writeFileSync(join(out, 'native.svg'), proof.svg);
    const flat = proof.text.flatMap(t => Array.from(t.text!).map((char, i) => ({ char, x: t.x, y: t.y, multi: t.text!.length > 1 }))).filter(g => g.char.trim());
    const same = flat.map(x => x.char).join('') === source.glyphs.map(x => x.char).join('');
    const diffs = same ? flat.map((g, i) => ({ marker: !!source.glyphs[i].marker, key: source.glyphs[i].key, offset: source.glyphs[i].offset, dx: g.x - source.glyphs[i].x, dy: g.y - source.glyphs[i].y, multi: g.multi })).filter(d => !d.marker) : [];
    const metrics = { out, pages: proof.pages, textExact: same, multiText: same ? diffs.filter(x => x.multi).length : flat.filter(x => x.multi).length, maxX: Math.max(0, ...diffs.map(d => Math.abs(d.dx))), maxY: Math.max(0, ...diffs.map(d => Math.abs(d.dy))), diffs, result, hashes };
    writeFileSync(join(out, 'result.json'), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify({ ...metrics, diffs: undefined }));
    assert.equal(proof.pages, 1);
    assert.ok(same, 'Semantic text mismatch');
    assert.equal(metrics.multiText, 0, 'Ambiguous multi glyph SVG segment requires separate matching');
    assert.ok(metrics.maxX <= .51, 'Glyph X > .51px');
    assert.ok(metrics.maxY <= .1, 'Baseline Y > .1px');
    assert.deepEqual(Object.fromEntries(files.map(n => [n, hash(readFileSync('apps/web/src/documents/' + n))])), hashes);
}
finally {
    await browser.close();
    await server.close();
} }
test('CF252 actual HWP preserves fresh paragraph, mixed fonts, lists, BR and aligned cell glyphs', main);

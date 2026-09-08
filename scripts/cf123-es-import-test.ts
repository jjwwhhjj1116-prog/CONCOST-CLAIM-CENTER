import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { chromium, type Browser } from 'playwright-core';

// No original workbook copy, disk export, server route, trace, screenshot or customer-value log.
// The approved source is read once, injected into an isolated browser's memory, then discarded.
const root = path.resolve(__dirname, '..');
const sourcePath = process.env.CF123_ES_SOURCE ?? path.resolve(root, '../../tmp/es-v2-input-20260908/ES_Codex_v2_Package/reference/물가변동 추정산출서.xlsx');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const viteRequire = createRequire(webRequire.resolve('vite'));
const { build } = viteRequire('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };

// Serialized into the browser bundle. All source mutations stay inside this function's memory.
async function browserChecks(sourceBase64: string) {
  const api = (window as any).__esImport;
  const { importEsWorkbook, exportEsWorking, exportEsReport, calculateEs, newEsInput, unzipSync, zipSync, strFromU8, strToU8 } = api;
  const cases: Array<{ id: string; status: 'PASS' | 'FAIL'; detail: string }> = [];
  const check = async (id: string, action: () => Promise<void>) => {
    try { await action(); cases.push({ id, status: 'PASS', detail: '' }); }
    catch (error) { const message = error instanceof Error ? error.message : ''; cases.push({ id, status: 'FAIL', detail: message.startsWith('QA_SAFE:') ? message : 'Assertion failed; source values and raw errors deliberately omitted.' }); }
  };
  const diffPaths = (a: any, b: any, prefix = '$'): string[] => {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [prefix];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => diffPaths(a[key], b[key], `${prefix}.${key}`)).slice(0, 40);
  };
  const equal = (a: unknown, b: unknown) => { const paths = diffPaths(a, b); if (paths.length) throw new Error(`QA_SAFE: differing schema paths only: ${paths.join(', ')}`); };
  const ok = (condition: unknown) => { if (!condition) throw new Error('Expectation failed'); };
  const rejected = async (bytes: Uint8Array) => { let failed = false; try { await importEsWorkbook(bytes); } catch { failed = true; } ok(failed); };
  const parse = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
  const text = (files: Record<string, Uint8Array>, key: string) => strFromU8(files[key]);
  const xml = (files: Record<string, Uint8Array>, key: string) => parse(text(files, key));
  const save = (files: Record<string, Uint8Array>, key: string, doc: Document) => { files[key] = strToU8(new XMLSerializer().serializeToString(doc)); };
  const tags = (node: Document | Element, name: string): Element[] => Array.from(node.getElementsByTagNameNS('*', name));
  const cell = (doc: Document, address: string) => tags(doc, 'c').find(c => c.getAttribute('r') === address)!;
  const sheetPath = (files: Record<string, Uint8Array>, name: string) => {
    const sheet = tags(xml(files, 'xl/workbook.xml'), 'sheet').find(s => s.getAttribute('name') === name)!;
    const relation = tags(xml(files, 'xl/_rels/workbook.xml.rels'), 'Relationship').find(r => r.getAttribute('Id') === sheet.getAttribute('r:id'))!;
    const target = relation.getAttribute('Target')!; return target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
  };
  const shaText = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(v => v.toString(16).padStart(2, '0')).join('');
  const stringValue = (c: Element) => tags(c, 't').map(t => t.textContent ?? '').join('') || tags(c, 'v')[0]?.textContent || '';
  const setString = (doc: Document, c: Element, value: string) => {
    const ns = doc.documentElement.namespaceURI; c.replaceChildren(); c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(ns, 'is'), t = doc.createElementNS(ns, 't'); t.textContent = value; is.append(t); c.append(is);
  };
  const modify = async (bytes: Uint8Array, action: (files: Record<string, Uint8Array>) => void | Promise<void>) => { const files = unzipSync(bytes); await action(files); return zipSync(files); };
  const changeCaches = async (bytes: Uint8Array, remove: boolean) => modify(bytes, files => {
    for (const key of Object.keys(files).filter(key => /^xl\/worksheets\//.test(key))) {
      const doc = xml(files, key);
      for (const c of tags(doc, 'c').filter(c => tags(c, 'f').length)) {
        for (const v of tags(c, 'v')) v.remove();
        if (!remove) { const v = doc.createElementNS(doc.documentElement.namespaceURI, 'v'); v.textContent = '987654321'; c.append(v); }
      }
      save(files, key, doc);
    }
  });
  function synthetic() {
    const value = newEsInput(); value.title = 'Synthetic parser QA'; value.client = 'Synthetic'; value.contractor = 'Synthetic';
    value.baseDate = '2024-01-01'; value.adjustmentDate = '2024-03-01'; value.contractAmount = '1000000'; value.costs['11'] = '100000';
    value.directPaid = ['100', '0'];
    for (const [period, date, wage] of [[value.base, value.baseDate, '100'], [value.current.period, value.adjustmentDate, '105'], [value.previous.period, '2024-02-29', '104']]) {
      period.date = date; period.wage = wage; period.materials = ['100', '100', '100', '100']; period.source = 'Synthetic';
      for (const key of Object.keys(period.rates)) period.rates[key] = '1';
    }
    for (const comparison of [value.current, value.previous]) for (const pair of [comparison.machinery, ...comparison.standards]) Object.assign(pair, { baseAverage: '100', comparisonAverage: '105', commonCount: '1', source: 'Synthetic' });
    return value;
  }
  const original = Uint8Array.from(atob(sourceBase64), c => c.charCodeAt(0));
  const originalStructure = unzipSync(original);
  const formulaBackedPairKeys = ['토목표준', '건축표준', '기계표준', '전기표준', '통신표준'].map(name => {
    const doc = xml(originalStructure, sheetPath(originalStructure, name));
    const formulas = tags(doc, 'c').filter(c => tags(c, 'f').length).map(c => c.getAttribute('r') ?? '');
    return { sheet: name, labelCells: formulas.filter(address => /^[DE]\d+$/.test(address) && Number(address.slice(1)) >= 25 && Number(address.slice(1)) <= 109).slice(0, 12), pairKeyCells: formulas.filter(address => /^L\d+$/.test(address)).slice(0, 12) };
  });
  let baseline: any;
  await check('original_exact_27_formula_fingerprints', async () => {
    baseline = await importEsWorkbook(original); equal(baseline.kind, 'ORIGINAL');
    ok(baseline.warnings.some((warning: string) => /27시트.*지문이 일치/.test(warning)));
  });
  await check('original_one_formula_change_warns_without_execution', async () => {
    ok(baseline);
    const altered = await modify(original, files => {
      const key = sheetPath(files, '2.1'), doc = xml(files, key), f = tags(doc, 'f').find(f => Boolean(f.textContent))!;
      ok(f); f.textContent = '1+987654321'; save(files, key, doc);
    });
    const imported = await importEsWorkbook(altered); equal(imported.input, baseline.input);
    ok(imported.warnings.some((warning: string) => /수식 구성이 다르/.test(warning)));
    equal(calculateEs(imported.input), calculateEs(baseline.input));
  });
  await check('original_literal_identity_fields_are_mapped_without_title_formula_cache', async () => {
    const changed = await modify(original, files => {
      const key = sheetPath(files, '기본입력'), doc = xml(files, key);
      for (const [address, value] of [['C7', 'Synthetic client'], ['C8', 'Synthetic construction'], ['C9', 'Synthetic contractor']]) setString(doc, cell(doc, address), value);
      save(files, key, doc);
    });
    const imported = await importEsWorkbook(changed);
    equal({ title: imported.input.title, client: imported.input.client, contractor: imported.input.contractor }, { title: 'Synthetic construction', client: 'Synthetic client', contractor: 'Synthetic contractor' });
    const withoutCaches = await importEsWorkbook(await changeCaches(changed, true)); equal(withoutCaches.input, imported.input);
  });
  for (const remove of [false, true]) await check(remove ? 'original_absent_formula_caches_not_used' : 'original_stale_formula_caches_not_used', async () => {
    ok(baseline); const imported = await importEsWorkbook(await changeCaches(original, remove)); equal(imported.input, baseline.input); equal(calculateEs(imported.input), calculateEs(baseline.input));
  });
  await check('original_sheet_order_is_not_mapping_identity', async () => {
    ok(baseline); const changed = await modify(original, files => { const doc = xml(files, 'xl/workbook.xml'), sheets = tags(doc, 'sheets')[0]; sheets.replaceChildren(...Array.from(sheets.children).reverse()); save(files, 'xl/workbook.xml', doc); });
    const imported = await importEsWorkbook(changed); equal(imported.input, baseline.input); ok(imported.warnings.some((s: string) => /27시트.*지문이 일치/.test(s)));
  });
  await check('original_1904_epoch_preserves_calendar_dates_and_results', async () => {
    ok(baseline);
    const changed = await modify(original, files => {
      const workbook = xml(files, 'xl/workbook.xml'); let prop = tags(workbook, 'workbookPr')[0];
      if (!prop) { prop = workbook.createElementNS(workbook.documentElement.namespaceURI, 'workbookPr'); workbook.documentElement.prepend(prop); }
      prop.setAttribute('date1904', '1'); save(files, 'xl/workbook.xml', workbook);
      const adjust = (name: string, addresses: string[]) => { const key = sheetPath(files, name), doc = xml(files, key); for (const address of addresses) { const c = cell(doc, address); if (!c || tags(c, 'f').length) continue; const v = tags(c, 'v')[0]; if (v && Number(v.textContent) > 1462 && !['s', 'inlineStr'].includes(c.getAttribute('t') ?? 'n')) v.textContent = String(Number(v.textContent) - 1462); } save(files, key, doc); };
      const list = (col: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => col + (from + i));
      adjust('기본입력', ['C10', 'C11', 'C12', 'C13', 'C17', 'C18', 'C19', 'E12', 'E17', 'E18', 'E19', ...list('H', 51, 61), ...list('H', 64, 67), ...list('J', 35, 48), ...list('L', 35, 48), ...list('N', 35, 48)]);
      for (const name of ['토목표준', '건축표준', '기계표준', '전기표준', '통신표준']) {
        const doc = xml(files, sheetPath(files, name));
        const pairDates = tags(doc, 'c').map(c => c.getAttribute('r') ?? '').filter(address => /^[OT]\d+$/.test(address) && Number(address.slice(1)) >= 26);
        adjust(name, [...list('C', 25, 109), ...pairDates]);
      }
    });
    const imported = await importEsWorkbook(changed); equal(imported.input, baseline.input); equal(calculateEs(imported.input), calculateEs(baseline.input));
  });
  const sample = synthetic(), working = await exportEsWorking(sample), roundTrip = await importEsWorkbook(working);
  await check('working_chain_1_exact_round_trip', async () => { equal(roundTrip.kind, 'WORKING'); equal(roundTrip.input, sample); equal(calculateEs(roundTrip.input), calculateEs(sample)); const files = unzipSync(working); ok(text(files, sheetPath(files, 'ES_작업정보')).includes('CHAIN_1')); });
  await check('working_chain_1_edited_input_recalculates_on_import', async () => {
    const changed = await modify(working, files => { const key = sheetPath(files, 'ES_입력'), doc = xml(files, key), label = tags(doc, 'c').find(c => stringValue(c) === 'contractAmount')!; const row = label.getAttribute('r')!.slice(1); setString(doc, cell(doc, `B${row}`), '2000000'); save(files, key, doc); });
    const imported = await importEsWorkbook(changed), expected = synthetic(); expected.contractAmount = '2000000'; equal(imported.input, expected); equal(calculateEs(imported.input), calculateEs(expected));
  });
  for (const remove of [false, true]) await check(remove ? 'working_absent_formula_caches_not_used' : 'working_stale_formula_caches_not_used', async () => { const imported = await importEsWorkbook(await changeCaches(working, remove)); equal(imported.input, sample); equal(calculateEs(imported.input), calculateEs(sample)); });
  await check('working_blank_cells_removed_by_excel_remain_blank', async () => {
    const blank = newEsInput(), bytes = await exportEsWorking(blank), changed = await modify(bytes, files => { const key = sheetPath(files, 'ES_입력'), doc = xml(files, key); for (const c of tags(doc, 'c')) if (c.getAttribute('r')?.startsWith('B') && stringValue(c) === '' && !tags(c, 'f').length) c.remove(); save(files, key, doc); });
    equal((await importEsWorkbook(changed)).input, blank);
  });
  await check('working_row_labels_cannot_be_rebound', async () => rejected(await modify(working, files => { const key = sheetPath(files, 'ES_입력'), doc = xml(files, key); setString(doc, cell(doc, 'A2'), 'ownerId'); save(files, key, doc); })));
  await check('working_supported_formula_change_rejected', async () => rejected(await modify(working, files => { const key = sheetPath(files, 'ES_계산'), doc = xml(files, key); tags(doc, 'f')[0].textContent = '1+1'; save(files, key, doc); })));
  await check('working_extra_formula_outside_chain_rejected', async () => rejected(await modify(working, files => { const key = sheetPath(files, 'ES_계산'), doc = xml(files, key), c = cell(doc, 'A1'); c.replaceChildren(); const f = doc.createElementNS(doc.documentElement.namespaceURI, 'f'); f.textContent = '1+1'; c.append(f); save(files, key, doc); })));
  await check('working_metadata_integrity_change_rejected', async () => rejected(await modify(working, files => { const key = sheetPath(files, 'ES_작업정보'), doc = xml(files, key); setString(doc, cell(doc, 'A4'), '{}'); save(files, key, doc); })));
  await check('working_forged_acl_even_with_recomputed_hash_is_discarded', async () => {
    const changed = await modify(working, async files => { const key = sheetPath(files, 'ES_작업정보'), doc = xml(files, key), encoded = stringValue(cell(doc, 'A4')), payload = JSON.parse(encoded); Object.assign(payload, { ownerId: 'attacker', organizationId: 'other-company', documentId: 'forged', approval: 'APPROVED', result: { net: '999999' } }); const json = JSON.stringify(payload); setString(doc, cell(doc, 'A4'), json); setString(doc, cell(doc, 'B1'), await shaText(json)); save(files, key, doc); });
    equal((await importEsWorkbook(changed)).input, sample);
  });
  await check('submission_workbook_is_not_an_editable_source', async () => rejected(exportEsReport(sample, calculateEs(sample), ['cover', 'rate_details', 'previous_day_index_details'])));
  await check('wrong_zip_header_rejected', async () => rejected(new Uint8Array([1, 2, 3, 4])));
  await check('truncated_zip_rejected', async () => rejected(working.slice(0, working.length - 40)));
  await check('zip_path_traversal_rejected', async () => rejected(await modify(working, files => { files['../escape.xml'] = strToU8('<x/>'); })));
  await check('malformed_xml_rejected', async () => rejected(await modify(working, files => { files['xl/workbook.xml'] = strToU8('<workbook><broken>'); })));
  await check('xml_doctype_entity_rejected', async () => rejected(await modify(working, files => { files['xl/workbook.xml'] = strToU8('<!DOCTYPE workbook [<!ENTITY x SYSTEM "https://forbidden.invalid/source">]>' + text(files, 'xl/workbook.xml').replace(/<\?xml[^?]*\?>/, '')); })));
  await check('external_worksheet_relationship_rejected', async () => rejected(await modify(working, files => { const doc = xml(files, 'xl/_rels/workbook.xml.rels'), rel = tags(doc, 'Relationship')[0]; rel.setAttribute('TargetMode', 'External'); rel.setAttribute('Target', 'https://forbidden.invalid/sheet.xml'); save(files, 'xl/_rels/workbook.xml.rels', doc); })));
  for (const formula of ['DDE("cmd","/c noop","")', 'WEBSERVICE("https://forbidden.invalid/")', 'cmd|topic!A1']) await check(`unsafe_formula_${formula.startsWith('cmd') ? 'pipe' : formula.split('(')[0]}`, async () => rejected(await modify(working, files => { const key = sheetPath(files, 'ES_계산'), doc = xml(files, key); tags(doc, 'f')[0].textContent = formula; save(files, key, doc); })));
  await check('xlsm_vba_payload_rejected', async () => rejected(await modify(working, files => { files['xl/vbaProject.bin'] = new Uint8Array([1]); })));
  await check('macro_enabled_container_without_vba_payload_rejected', async () => rejected(await modify(working, files => { files['[Content_Types].xml'] = strToU8(text(files, '[Content_Types].xml').replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml')); })));
  await check('duplicate_sheet_names_rejected', async () => rejected(await modify(working, files => { const doc = xml(files, 'xl/workbook.xml'), sheets = tags(doc, 'sheet'); sheets[1].setAttribute('name', sheets[0].getAttribute('name')!); save(files, 'xl/workbook.xml', doc); })));
  return { cases, formulaBackedPairKeys, domParser: typeof DOMParser === 'function', originalKindVerified: baseline?.kind === 'ORIGINAL' };
}

test('CF123 isolated browser executes real DOMParser import guards without retaining original data', async () => {
  assert.ok(existsSync(sourcePath), 'Set CF123_ES_SOURCE to the approved, read-only original workbook');
  const source = readFileSync(sourcePath), sourceHashBefore = sha(source);
  const bundle = await build({ stdin: { contents: `import { importEsWorkbook, exportEsWorking, exportEsReport } from './apps/web/src/es/es-xlsx';\nimport { calculateEs,newEsInput } from './packages/document-engine/src/es-calculation';\nimport { unzipSync,zipSync,strFromU8,strToU8 } from './apps/web/node_modules/fflate';\nconst __name=(fn)=>fn;\nwindow.__esImport={importEsWorkbook,exportEsWorking,exportEsReport,calculateEs,newEsInput,unzipSync,zipSync,strFromU8,strToU8};\nwindow.__esParserChecks=${browserChecks.toString()};`, resolveDir: root, sourcefile: 'parser-qa-inline.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'chrome120', logLevel: 'silent' });
  const script = bundle.outputFiles[0].text;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><title>Isolated ES parser QA</title><p>In-memory parser regression. No document contents are displayed.</p><script type="module" src="/harness.js"></script>'); }
    else if (request.url === '/harness.js') { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(script); }
    else { response.writeHead(404); response.end(); }
  });
  let browser: Browser | undefined;
  const artifact = path.join(root, 'outputs/cf123-es/parser-qa.json');
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(value => value && existsSync(value));
    assert.ok(executablePath, 'A local Chromium executable is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const forbiddenRequests: string[] = [];
    await context.route('**/*', async route => { const url = new URL(route.request().url()); if (url.origin === origin && ['/', '/harness.js'].includes(url.pathname)) await route.continue(); else { forbiddenRequests.push(url.origin); await route.abort(); } });
    const page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => typeof (window as any).__esParserChecks === 'function');
    const report = await page.evaluate(async bytes => await (window as any).__esParserChecks(bytes), source.toString('base64'));
    const sourceHashAfter = sha(readFileSync(sourcePath));
    const output = { ...report, forbiddenRequestCount: forbiddenRequests.length, sourceHashBefore, sourceHashAfter, sourceUnchanged: sourceHashAfter === sourceHashBefore, scope: 'Browser-memory parser tests only. No Excel recalculation, UI file-picker extension guard, server upload or native rendering claim.' };
    mkdirSync(path.dirname(artifact), { recursive: true }); writeFileSync(artifact, JSON.stringify(output, null, 2));
    for (const item of report.cases) console.log(`${item.status} ${item.id}${item.detail ? ` ${item.detail}` : ''}`);
    assert.equal(sourceHashAfter, sourceHashBefore, 'The approved source bytes must remain untouched'); assert.equal(forbiddenRequests.length, 0, 'The parser must not request external resources');
    const failures = report.cases.filter((item: { status: string }) => item.status !== 'PASS'); assert.equal(failures.length, 0, failures.map((item: { id: string }) => item.id).join(', '));
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

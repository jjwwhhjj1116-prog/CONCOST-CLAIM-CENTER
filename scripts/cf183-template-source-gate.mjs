// Read-only local originals. Keep real names and customer text out of the results.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function exportNativeWithReport(document, format) {
  assert.ok(format === 'hwp' || format === 'hwpx');
  const result = format === 'hwp' ? document.exportHwpWithReport() : document.exportHwpxWithReport();
  try {
    const report = JSON.parse(result.contentLoss());
    assert.equal(report.schemaVersion, 1);
    assert.equal(typeof report.outputFormat, 'string');
    assert.equal(report.outputFormat.toLowerCase(), format);
    assert.ok(Number.isSafeInteger(report.count) && report.count >= 0 && Array.isArray(report.losses));
    // The report and these bytes come from one export, not two serializer calls.
    const bytes = result.takeBytes();
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
    return { bytes, report: { schemaVersion: report.schemaVersion, outputFormat: format, count: report.count, lossRecords: report.losses.length } };
  } finally { result.free(); }
}

export function nativeEvidencePass(evidence, file, engineSha256) {
  const check = evidence?.results?.[0], format = file.extension === '.hwp' ? 'hwp' : 'hwpx';
  return evidence?.sourceSha256 === file.sha256 && evidence?.engineSha256 === engineSha256 && evidence?.originalUnchanged === true && Array.isArray(evidence.results) &&
    evidence.results.length === 1 && check?.inputLength === 0 && check.inserted === true && check.retained === true &&
    Number.isSafeInteger(check.pagesBefore) && check.pagesBefore > 0 && check.pagesBefore === check.pagesAfter && check.pagesBefore === check.pagesAfterSecond &&
    Array.isArray(check.differentPages) && check.differentPages.length === 0 && Array.isArray(check.secondSaveDifferentPages) && check.secondSaveDifferentPages.length === 0 &&
    check.controlChainsMatch === true && Array.isArray(check.controlChains) && check.controlChains.length === 3 && check.controlChains.every(chain =>
      chain && Number.isSafeInteger(chain.count) && chain.count >= 0 && /^[a-f0-9]{64}$/u.test(chain.sha256) && chain.count === check.controlChains[0].count && chain.sha256 === check.controlChains[0].sha256) &&
    check.contentLossVerified === true && check.pass === true &&
    Array.isArray(check.exportReports) && check.exportReports.length === 2 && check.exportReports.every(report =>
      report && report.schemaVersion === 1 && report.outputFormat === format && report.count === 0 && report.lossRecords === 0);
}

export function matchReferenceSources(sourceRoot, inventory) {
  const root = realpathSync(sourceRoot);
  assert.equal(inventory.files.length, inventory.totalFiles);
  assert.equal(new Set(inventory.files.map(file => file.fileId)).size, inventory.totalFiles, 'Duplicate reference ID');
  const candidates = readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const name = path.join(entry.parentPath, entry.name), actual = realpathSync(name);
    assert.ok(actual.startsWith(root + path.sep), 'Source outside the explicit root');
    return { name: actual, extension: path.extname(actual).toLowerCase(), bytes: statSync(actual).size };
  });
  assert.equal(candidates.length, inventory.totalFiles, 'Original inventory count mismatch');
  const used = new Set();
  return inventory.files.map(file => {
    assert.match(file.fileId, /^TPL-REF-\d{3}$/u);
    const matches = candidates.filter(candidate => candidate.extension === file.extension && candidate.bytes === file.sizeBytes && sha(readFileSync(candidate.name)) === file.sha256);
    assert.equal(matches.length, 1, file.fileId + ': missing or duplicate source bytes');
    assert.equal(used.has(matches[0].name), false, 'Reference IDs must identify distinct files'); used.add(matches[0].name);
    return { ...file, source: matches[0].name };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sourceRoot = process.env.CF183_SOURCE_ROOT;
  const pdfInfo = process.env.CF183_PDFINFO;
  assert.ok(sourceRoot && pdfInfo, 'CF183_SOURCE_ROOT and CF183_PDFINFO are required');
  const inventory = JSON.parse(readFileSync('docs/templates/reference-inventory.json', 'utf8'));
  const files = matchReferenceSources(sourceRoot, inventory);
  assert.equal(files.length, 32);
  const runName = process.env.CF183_RUN_NAME || 'cf183-source-gate';
  assert.match(runName, /^[a-zA-Z0-9_-]+$/u);
  const output = path.resolve('tmp', runName);
  assert.equal(existsSync(output), false, 'Preserve the existing gate results; use a new run name');
  mkdirSync(output, { recursive: true });
  const report = { scope: 'Actual originals, local parser/serialization only; not PC Hancom, full visual fidelity, or Drive persistence', sourceFiles: 32, engineSha256: sha(readFileSync('pinned-runtime/pkg/rhwp_bg.wasm')), results: [] };
  assert.equal(report.engineSha256, 'bcc40a79bcd9be813cb231c6d8a0376b803ab8a6c189a09bcccabb8a249f3c44');
  let failures = 0;
  for (const file of files) {
    console.log(JSON.stringify({ id: file.fileId, extension: file.extension, stage: 'START' }));
    const result = { id: file.fileId, extension: file.extension, sourceSha256: file.sha256, bytes: file.sizeBytes };
    const started = Date.now();
    if (/^\.hwpx?$/u.test(file.extension)) {
      const childFile = path.join(output, file.fileId + '-roundtrip.json');
      const child = spawnSync(process.execPath, ['--max-old-space-size=768', 'scripts/cf149-hwpx-edit-roundtrip.mjs', 'pinned-runtime/pkg', file.source], {
        encoding: 'utf8', timeout: 60000, maxBuffer: 2_000_000, windowsHide: true,
        env: { ...process.env, CF149_NO_EDIT_ONLY: '1', CF149_EXPORT_FORMAT: file.extension === '.hwp' ? 'hwp' : 'hwpx', CF149_REQUIRE_CONTENT_LOSS: '1', CF149_EXPECTED_PAGES: '0', CF149_RESULT_FILE: childFile }
      });
      try { if (existsSync(childFile)) result.roundtrip = JSON.parse(readFileSync(childFile, 'utf8')); }
      catch { result.evidenceError = 'INVALID_CHILD_EVIDENCE'; }
      result.status = child.error?.code === 'ETIMEDOUT' ? 'TIMEOUT_UNVERIFIED' : !child.error && !child.signal && child.status === 0 && nativeEvidencePass(result.roundtrip, file, report.engineSha256) ? 'PASS_NATIVE_SELF_ROUNDTRIP' : 'FAIL_NATIVE_CHECK';
      result.exitCode = child.status;
      // Do not print raw native warnings, customer text, or real filenames.
    } else if (file.extension === '.pdf') {
      const child = spawnSync(pdfInfo, [file.source], { encoding: 'utf8', timeout: 20000, maxBuffer: 100000, windowsHide: true });
      const pages = /^Pages:\s+(\d+)/mu.exec(child.stdout ?? ''), size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/mu.exec(child.stdout ?? '');
      result.status = !child.error && !child.signal && child.status === 0 && pages && Number(pages[1]) > 0 && size && Number(size[1]) > 0 && Number(size[2]) > 0 ? 'PASS_PDF_METADATA_ONLY' : 'FAIL_PDF_METADATA';
      result.pages = pages ? Number(pages[1]) : null;
      result.pageSizePoints = size ? [Number(size[1]), Number(size[2])] : null;
    } else {
      // XLSX is inventoried, not silently counted as an HWP/PDF layout pass.
      result.status = 'INVENTORY_ONLY_XLSX';
    }
    result.originalUnchanged = sha(readFileSync(file.source)) === file.sha256;
    result.elapsedMs = Date.now() - started;
    if (!result.originalUnchanged || result.status.startsWith('FAIL') || result.status.startsWith('TIMEOUT')) failures++;
    report.results.push(result);
    writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ id: result.id, status: result.status, originalUnchanged: result.originalUnchanged, elapsedMs: result.elapsedMs, pages: result.pages ?? result.roundtrip?.results?.[0]?.pagesBefore ?? null }));
  }
  assert.ok(files.every(file => sha(readFileSync(file.source)) === file.sha256), 'Original source bytes changed');
  process.exitCode = failures ? 1 : 0;
}

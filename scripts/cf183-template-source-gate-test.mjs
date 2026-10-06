import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { exportNativeWithReport, matchReferenceSources, nativeEvidencePass } from './cf183-template-source-gate.mjs';

test('CF183 export report is paired with exactly one bytes result and malformed reports fail closed', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const valid = { schemaVersion: 1, outputFormat: 'HWP', count: 0, losses: [] };
  const run = report => {
    const calls = [];
    const document = { exportHwpWithReport() { calls.push('export'); return {
      contentLoss() { calls.push('report'); return typeof report === 'string' ? report : JSON.stringify(report); },
      takeBytes() { calls.push('bytes'); return bytes; }, free() { calls.push('free'); }
    }; } };
    return { calls, export: () => exportNativeWithReport(document, 'hwp') };
  };
  const good = run(valid), result = good.export();
  assert.equal(result.bytes, bytes);
  assert.deepEqual(good.calls, ['export', 'report', 'bytes', 'free']);
  for (const bad of ['invalid JSON', { ...valid, schemaVersion: 2 }, { ...valid, outputFormat: 'hwpx' }, { ...valid, outputFormat: null }, { ...valid, count: -1 }, { ...valid, count: 0.5 }, { ...valid, losses: null }]) {
    const item = run(bad); assert.throws(item.export); assert.deepEqual(item.calls, ['export', 'report', 'free']);
  }
});

test('CF183 parent requires real no-edit evidence, not exit code or a claimed pass flag', () => {
  const file = { extension: '.hwp', sha256: 'source-sha' }, engine = 'engine-sha';
  const report = { schemaVersion: 1, outputFormat: 'hwp', count: 0, lossRecords: 0 };
  const chain = { count: 5, sha256: 'a'.repeat(64) };
  const check = { inputLength: 0, inserted: true, retained: true, pagesBefore: 17, pagesAfter: 17, pagesAfterSecond: 17, differentPages: [], secondSaveDifferentPages: [], controlChains: [chain, chain, chain], controlChainsMatch: true, contentLossVerified: true, pass: true, exportReports: [report, report] };
  const evidence = { sourceSha256: file.sha256, engineSha256: engine, originalUnchanged: true, results: [check] };
  assert.equal(nativeEvidencePass(evidence, file, engine), true);
  assert.equal(nativeEvidencePass(undefined, file, engine), false);
  for (const change of [{ sourceSha256: 'other' }, { engineSha256: 'other' }, { originalUnchanged: false }, { results: null }, { results: [] }, { results: [check, check] }]) assert.equal(nativeEvidencePass({ ...evidence, ...change }, file, engine), false);
  for (const change of [{ inputLength: 4 }, { pagesBefore: 0 }, { pagesAfterSecond: 18 }, { differentPages: [1] }, { secondSaveDifferentPages: [2] }, { controlChainsMatch: false }, { contentLossVerified: false }, { pass: false }, { exportReports: [report] }, { exportReports: [report, { ...report, count: 1 }] }, { exportReports: [report, { ...report, lossRecords: 1 }] }, { exportReports: [report, { ...report, outputFormat: 'hwpx' }] }]) assert.equal(nativeEvidencePass({ ...evidence, results: [{ ...check, ...change }] }, file, engine), false);
  for (const controlChains of [[], [chain, chain], [chain, chain, null], [chain, chain, { ...chain, count: -1 }], [chain, chain, { ...chain, sha256: 'b'.repeat(64) }], [chain, chain, { ...chain, count: 6 }], [chain, chain, { ...chain, sha256: 'invalid' }]]) assert.equal(nativeEvidencePass({ ...evidence, results: [{ ...check, controlChains }] }, file, engine), false);
});

test('CF183 source matching uses bytes rather than anonymized filenames and fails closed on missing/duplicate/tampered files', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(path.resolve('tmp/cf183-source-fixture-'));
  const bytes = Buffer.from('synthetic source, no customer data');
  const original = path.join(root, 'actual-local-name.hwp'); writeFileSync(original, bytes);
  const row = { fileId: 'TPL-REF-001', filename: 'anonymized.hwp', extension: '.hwp', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const inventory = { totalFiles: 1, files: [row] };
  assert.equal(matchReferenceSources(root, inventory)[0].source, original);
  assert.throws(() => matchReferenceSources(root, { totalFiles: 1, files: [{ ...row, sha256: '0'.repeat(64) }] }), /missing or duplicate/);
  assert.throws(() => matchReferenceSources(root, { totalFiles: 2, files: [row, row] }), /Duplicate reference ID/);
  writeFileSync(path.join(root, 'duplicate.hwp'), bytes);
  assert.throws(() => matchReferenceSources(root, inventory), /inventory count mismatch/);
  assert.throws(() => matchReferenceSources(root, { totalFiles: 2, files: [row, { ...row, fileId: 'TPL-REF-002' }] }), /missing or duplicate/);
  assert.deepEqual(readFileSync(original), bytes);
});

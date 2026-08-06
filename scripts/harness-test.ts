import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Exact SHA-256 Hash Map for all 32 reference template files (Tamper-Proof Protection)
const EXPECTED_EXACT_SHAS: Record<string, string> = {
  "TPL-REF-001": "793cf78dd4262af8ddfddc77b85e5052f379e76d9e30f437cb799b9c43cec40a",
  "TPL-REF-002": "07e6483b00146f2aae5440e426e67e0c3a109dfd03b5e4ceb45dd3c1da222863",
  "TPL-REF-003": "33d47c460c30f5df150d0c213e16b02bad32af118932d7509e92521ef3d3656c",
  "TPL-REF-004": "2841c45be4cb33c376196415a942dd67bbc5a4a63ed4167548c50c18ead02818",
  "TPL-REF-005": "79bdd80d6ea68e2bdbe1d5eb79b082c12fbcd7dfc41d8a17f8e0af6cb15bc8b9",
  "TPL-REF-006": "799f600cc28b85a2d9b3de0b4e4e30160f4ca016891346bbdc955d7ba09a48cb",
  "TPL-REF-007": "803a7dac76f5dfb641d6ed09545bd8c3e1bc705e70fc3d6c313d9bdcc9a5862a",
  "TPL-REF-008": "b5fc68e971e16c0dc10afdad52ade68466d79f49c5c6632c8bd6746b9b3f733c",
  "TPL-REF-009": "54916152527b6669d0b984e1452913369029b749e168396bbf89193174358e73",
  "TPL-REF-010": "48e695fc178c9c5ab7e1922accc11085fad8ffa90a83801dc31988a1212392b5",
  "TPL-REF-011": "704d15f89b301236454ff745a320abfd07a9f81dfe59f01ac80c1200a5a3ab08",
  "TPL-REF-012": "b2fa6c4b8d73139b362ec7bf8bf3a0830079d546046e186e5fecf4271cce0589",
  "TPL-REF-013": "cf615ffc0de836aa17238ce06f432efd2054554d24e3adeb3a95d028429073e7",
  "TPL-REF-014": "3cfe73cd7abfd509ecb59c2d01f4d4dd6016d295d504bc7ba83fe268ab2f8912",
  "TPL-REF-015": "295323489bfccd6b6a87287c2670756cf5f3f6114ce20a6b6863fa28ed709611",
  "TPL-REF-016": "aae869dd91d5466d7c9553c124efd1cc26da2bfb8543b247c2ad3d5b53a8a54e",
  "TPL-REF-017": "46654b6954f7db138db189e90a256ebaab9721f8089f20536236e0690fa6f538",
  "TPL-REF-018": "af54833985f8e95683c8fb4c7e5daf07d8c5bef9a5c33187c12c26028cb240e5",
  "TPL-REF-019": "5b250214112613ba64344bc07fd42c35a8b02658a48c1a0161e85f329e64d175",
  "TPL-REF-020": "4f11c2e0a80a2a48ebc1c9c4d7fd5a7903a1ee7eeec33741969e81fd13dd835b",
  "TPL-REF-021": "c2b08275275061270eeebd87ad2834cdb93686d8f5079805fee1c156d555c22b",
  "TPL-REF-022": "b92bd57ca313180477328c38f1997090662f45851aa1fea8a2080d3410d8840b",
  "TPL-REF-023": "b46af144ac4530f510b2bb4545bc5060713aa59e58143d56137c50d6843737fa",
  "TPL-REF-024": "2392e4723cdae1e26e111bffd27f463389de6ef9b0203b5894a7de27a3345534",
  "TPL-REF-025": "281822dcaab11013dbf8a4d05ede709cad9763504cb411319fb6b0db71830dc5",
  "TPL-REF-026": "036c826bab836a83962c1878bc7c8b5ee18d0120f3bf146ec535fbe7923d68be",
  "TPL-REF-027": "62bc005ed3a99120cfb631dfac47ce694f68d52a3ad73ee528a2eda6a87abb3b",
  "TPL-REF-028": "a8c1e0294ead3b86e5e7dc0eff30054d92a501b93dc518ccc559fd4365fcb4b1",
  "TPL-REF-029": "a0c647b7892a4078b24cc670f33329007a45877f8e8df3cb43b2516dbe54a644",
  "TPL-REF-030": "88babe364a7cacfbb1b5e25356f80c0bc6583cfc7a0c215346a5732117665c39",
  "TPL-REF-031": "602861a42ba7ed0e96842eb40c811073942086fb9213ed8c938bef7a5d7a3bf2",
  "TPL-REF-032": "017b8fb3aac57469b51ee8cc43cca7c58a56e58e49f31c6a38f9beaa42a9f707"
};

const EXPECTED_EXACT_SIZES: Record<string, number> = {
  "TPL-REF-001": 136192,
  "TPL-REF-002": 203934,
  "TPL-REF-003": 114688,
  "TPL-REF-004": 174688,
  "TPL-REF-005": 357376,
  "TPL-REF-006": 269206,
  "TPL-REF-007": 44544,
  "TPL-REF-008": 95079,
  "TPL-REF-009": 3795968,
  "TPL-REF-010": 659537,
  "TPL-REF-011": 15926862,
  "TPL-REF-012": 46330880,
  "TPL-REF-013": 6165350,
  "TPL-REF-014": 36212602,
  "TPL-REF-015": 4432896,
  "TPL-REF-016": 1603175,
  "TPL-REF-017": 13027301,
  "TPL-REF-018": 3343200,
  "TPL-REF-019": 1106432,
  "TPL-REF-020": 391445,
  "TPL-REF-021": 197120,
  "TPL-REF-022": 308448,
  "TPL-REF-023": 2474496,
  "TPL-REF-024": 1065603,
  "TPL-REF-025": 4141103,
  "TPL-REF-026": 1630464,
  "TPL-REF-027": 2698240,
  "TPL-REF-028": 1128344,
  "TPL-REF-029": 1216000,
  "TPL-REF-030": 856731,
  "TPL-REF-031": 15459328,
  "TPL-REF-032": 1869845
};

const EXPECTED_TEMPLATE_FOLDERS = [
  '01. 감정보완 신청서',
  '02. 항소에 대한 의견 보고서',
  '03. 설계변경+물가변동+간접비',
  '04. 하자검토 보고서',
  '05. 설계변경+물가변동',
  '06. 공사비 적정성 검토 보고서',
  '07. 하자조사 보고서',
  '08. 돌관공사비',
  '09. 기시공+미시공'
];

test('P00 Harness Directory Skeleton Verification', () => {
  const dirs: string[] = [
    'apps/web',
    'apps/api',
    'packages/ui',
    'packages/domain',
    'packages/database',
    'packages/ai-gateway',
    'packages/document-engine',
    'packages/google-workspace',
    'packages/test-fixtures',
    'docs/product',
    'docs/architecture',
    'docs/adr',
    'docs/harness',
    'docs/reviews/requests',
    'docs/stitch',
    'artifacts/harness/P00',
    'scripts'
  ];

  for (const d of dirs) {
    const fullPath: string = path.join(__dirname, '..', d);
    assert.strictEqual(fs.existsSync(fullPath), true, `Directory missing: ${d}`);
    assert.strictEqual(fs.existsSync(path.join(fullPath, '.gitkeep')), true, `.gitkeep missing in: ${d}`);
  }
});

test('P00 Essential Harness Files Verification', () => {
  const files: string[] = [
    'README.md',
    '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS.md',
    '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md',
    '03_CLAIM_6_TYPE_TEMPLATE_MAPPING_SPEC.md',
    '.gitignore',
    '.editorconfig',
    '.node-version',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'tsconfig.json',
    'docs/harness/phase-status.json',
    'docs/harness/working-agreement.md',
    'docs/harness/initial-state.json',
    'artifacts/harness/P00/manifest.json'
  ];

  for (const f of files) {
    const fullPath: string = path.join(__dirname, '..', f);
    assert.strictEqual(fs.existsSync(fullPath), true, `Required file missing: ${f}`);
  }
});

test('P01 Exhaustive Traceability, 6 Claim Types & Reference Inventory Assertions (v2 Re-baseline & Tamper-Proof Hardened)', () => {
  const productDocs: string[] = [
    'docs/product/product-brief.md',
    'docs/product/personas.md',
    'docs/product/navigation.md',
    'docs/product/status-flows.md',
    'docs/product/permissions-matrix.md',
    'docs/product/acceptance-scenarios.md',
    'docs/product/non-goals.md'
  ];

  // 1. Product Brief & Acceptance Scenarios file existence
  for (const doc of productDocs) {
    const fullPath: string = path.join(__dirname, '..', doc);
    assert.strictEqual(fs.existsSync(fullPath), true, `Product spec missing: ${doc}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 1500, `Product spec file suspiciously small (${stat.size} bytes): ${doc}`);
  }

  // 2. Exact 6 Fixed Claim Types (TYPE-01 ~ TYPE-06) Strict Assertion (Adversarial attack check: TYPE-07 must FAIL)
  const claimTypesPath = path.join(__dirname, '../docs/domain/claim-types.yaml');
  assert.strictEqual(fs.existsSync(claimTypesPath), true, 'docs/domain/claim-types.yaml missing');
  const claimTypesContent = fs.readFileSync(claimTypesPath, 'utf8');
  assert.ok(
    claimTypesContent.includes('# 원본 출처: docs/클레임 업무 프로세스.xlsx'),
    'claim-types.yaml must reference the actual source workbook path'
  );
  
  const typeMatches = claimTypesContent.match(/- id: TYPE-\d+/g) || [];
  assert.strictEqual(typeMatches.length, 6, `claim-types.yaml must contain EXACTLY 6 types (found: ${typeMatches.length}). TYPE-07 or extraneous types forbidden!`);
  
  for (let i = 1; i <= 6; i++) {
    const typeId = `TYPE-0${i}`;
    assert.ok(claimTypesContent.includes(typeId), `claim-types.yaml missing required fixed type: ${typeId}`);
  }
  assert.strictEqual(claimTypesContent.includes('TYPE-07'), false, 'Adversarial check failed: claim-types.yaml must NOT contain TYPE-07');

  // 3. 32 Template Files Reference Inventory Tamper-Proof & Anonymization Strict Assertion
  const inventoryPath = path.join(__dirname, '../docs/templates/reference-inventory.json');
  assert.strictEqual(fs.existsSync(inventoryPath), true, 'docs/templates/reference-inventory.json missing');
  const inventoryData = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  assert.strictEqual(inventoryData.totalFiles, 32, 'reference-inventory.json must contain exactly 32 template files');
  assert.strictEqual(inventoryData.files.length, 32, 'reference-inventory.json files array length must be 32');

  const expectedFileIds = Array.from({ length: 32 }, (_, index) => `TPL-REF-${String(index + 1).padStart(3, '0')}`);
  assert.deepStrictEqual(
    inventoryData.files.map((item: { fileId: string }) => item.fileId),
    expectedFileIds,
    'Inventory file IDs must be unique, ordered, and exactly TPL-REF-001 through TPL-REF-032'
  );

  for (const item of inventoryData.files) {
    assert.ok(item.fileId && EXPECTED_EXACT_SHAS[item.fileId], `Unknown fileId in inventory: ${item.fileId}`);
    
    // Strict SHA-256 Tamper Protection Check: Compare with EXACT expected 64-char SHA-256 map
    const expectedSha = EXPECTED_EXACT_SHAS[item.fileId];
    assert.strictEqual(
      item.sha256,
      expectedSha,
      `Adversarial check failed: SHA-256 hash mismatch for ${item.fileId}. Expected '${expectedSha}', got '${item.sha256}'. Arbitrary SHA-256 mutation detected!`
    );
    assert.strictEqual(
      item.sizeBytes,
      EXPECTED_EXACT_SIZES[item.fileId],
      `Reference size mismatch for ${item.fileId}`
    );

    const expectedFilename = `${item.fileId}_template_ref${item.extension}`;
    assert.strictEqual(
      item.filename,
      expectedFilename,
      `Adversarial check failed: Filename for ${item.fileId} is not properly anonymized`
    );

    assert.ok(['.hwp', '.hwpx', '.pdf', '.xlsx'].includes(item.extension), `Unsupported extension: ${item.extension}`);
    const pathParts = item.relativePath.split('/');
    assert.deepStrictEqual(
      pathParts.slice(0, 2),
      ['docs', '보고서 템플릿'],
      `Invalid inventory path root for ${item.fileId}`
    );
    assert.strictEqual(pathParts.length, 4, `Inventory path must have exactly four segments: ${item.fileId}`);
    assert.ok(EXPECTED_TEMPLATE_FOLDERS.includes(pathParts[2]), `Unknown or sensitive folder in inventory path: ${item.fileId}`);
    assert.strictEqual(pathParts[3], expectedFilename, `Inventory path filename mismatch: ${item.fileId}`);
    assert.strictEqual(item.scanStatus, item.extension === '.hwp' ? 'UNSCANNED' : 'REVIEW_REQUIRED');
  }

  const extensionCounts = inventoryData.files.reduce((counts: Record<string, number>, item: { extension: string }) => {
    counts[item.extension] = (counts[item.extension] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepStrictEqual(extensionCounts, { '.hwp': 13, '.pdf': 15, '.hwpx': 3, '.xlsx': 1 });

  const inventoryFolders = [...new Set(inventoryData.files.map((item: { relativePath: string }) => item.relativePath.split('/')[2]))].sort();
  assert.deepStrictEqual(inventoryFolders, [...EXPECTED_TEMPLATE_FOLDERS].sort(), 'Inventory must cover the exact nine reference folders');

  // 4. Template Classification Strict Assertion (Adversarial check: primaryType must be EXACTLY 1 single string per folder entry, no duplicates/arrays)
  const classPath = path.join(__dirname, '../docs/templates/template-classification.yaml');
  assert.strictEqual(fs.existsSync(classPath), true, 'docs/templates/template-classification.yaml missing');
  const classContent = fs.readFileSync(classPath, 'utf8');
  assert.ok(classContent.includes('TYPE-05'), 'template-classification.yaml missing TYPE-05');
  assert.ok(classContent.includes('TEMPLATE_NOT_FOUND'), 'template-classification.yaml must retain TEMPLATE_NOT_FOUND for TYPE-05');

  const mappingBlocks = classContent.split('- folder:').slice(1);
  assert.strictEqual(mappingBlocks.length, 9, `template-classification.yaml must have exactly 9 folder mappings (found: ${mappingBlocks.length})`);

  const classifiedFolders = mappingBlocks.map(block => block.split('\n')[0].trim().replace(/^['"]|['"]$/g, '')).sort();
  assert.deepStrictEqual(classifiedFolders, [...EXPECTED_TEMPLATE_FOLDERS].sort(), 'Classification folder keys must join exactly to inventory folders');
  const allowedTypeIds = new Set(Array.from({ length: 6 }, (_, index) => `TYPE-0${index + 1}`));

  for (const block of mappingBlocks) {
    const primaryMatches = block.match(/primaryType:/g) || [];
    assert.strictEqual(primaryMatches.length, 1, `Adversarial check failed: Each folder mapping must contain EXACTLY 1 primaryType (found ${primaryMatches.length} in block)`);

    const primaryLine = block.split('\n').find(l => l.includes('primaryType:')) || '';
    const val = primaryLine.split('primaryType:')[1].trim();
    assert.ok(val.startsWith('"TYPE-') || val.startsWith("'TYPE-") || val.startsWith("TYPE-"), `primaryType must be a valid TYPE-XX string (found: ${val})`);
    assert.strictEqual(val.includes('['), false, 'Adversarial check failed: primaryType must NOT be an array');
    assert.strictEqual(val.includes(','), false, 'Adversarial check failed: primaryType must NOT contain multiple comma-separated values');
    const primaryType = val.replace(/^['"]|['"]$/g, '');
    assert.ok(allowedTypeIds.has(primaryType), `primaryType must be one of TYPE-01 through TYPE-06 (found: ${primaryType})`);

    const secondarySection = block.match(/secondaryTypes:\s*(?:\[\])?\s*\n?((?:\s+-\s+["']TYPE-\d{2}["']\s*\n?)*)/);
    assert.ok(secondarySection, 'Each mapping must declare secondaryTypes as an array');
    const secondaryTypes = [...(secondarySection?.[1] ?? '').matchAll(/TYPE-\d{2}/g)].map(match => match[0]);
    assert.strictEqual(new Set(secondaryTypes).size, secondaryTypes.length, 'secondaryTypes must not contain duplicates');
    for (const secondaryType of secondaryTypes) {
      assert.ok(allowedTypeIds.has(secondaryType), `secondaryType must be one of TYPE-01 through TYPE-06 (found: ${secondaryType})`);
      assert.notStrictEqual(secondaryType, primaryType, 'secondaryTypes must not repeat primaryType');
    }
  }

  // 5. Template Review Queue 3 Conflicts Assertion
  const queuePath = path.join(__dirname, '../docs/templates/template-review-queue.yaml');
  assert.strictEqual(fs.existsSync(queuePath), true, 'docs/templates/template-review-queue.yaml missing');
  const queueContent = fs.readFileSync(queuePath, 'utf8');
  assert.ok(queueContent.includes('REV-001'), 'Review queue missing REV-001 (공사비 적정성)');
  assert.ok(queueContent.includes('REV-002'), 'Review queue missing REV-002 (재건축·재개발)');
  assert.ok(queueContent.includes('REV-003'), 'Review queue missing REV-003 (돌관공사비 vs 물량공사비)');

  // 6. Template Sensitivity Security Report Assertion
  const reportPath = path.join(__dirname, '../docs/templates/template-sensitivity-report.md');
  assert.strictEqual(fs.existsSync(reportPath), true, 'docs/templates/template-sensitivity-report.md missing');
  const reportContent = fs.readFileSync(reportPath, 'utf8');
  assert.ok(reportContent.includes('.gitignore'), 'Sensitivity report missing .gitignore security policy');
  assert.ok(reportContent.includes('ANONYMIZED_PROJECT_01'), 'Sensitivity report must include anonymized project tag');

  // 7. All 20 Screens ID Exhaustive Verification
  const scenariosContent = fs.readFileSync(path.join(__dirname, '../docs/product/acceptance-scenarios.md'), 'utf8');
  const all20Screens = [
    'AUTH-01', 'DASH-01', 'CASE-01', 'CASE-02', 'CASE-03',
    'CASE-04', 'CASE-05', 'CASE-06', 'MEET-01', 'PROP-01',
    'PROP-02', 'REPO-01', 'REPO-02', 'APPR-01', 'FEE-01',
    'TPL-01',  'AI-01',   'USER-01', 'AUD-01',  'RESP-01'
  ];
  for (const screenId of all20Screens) {
    assert.ok(scenariosContent.includes(screenId), `Traceability matrix missing screen ID: ${screenId}`);
  }

  // 8. All 33 System Data Entities Exhaustive Verification
  const briefContent = fs.readFileSync(path.join(__dirname, '../docs/product/product-brief.md'), 'utf8');
  const all33Entities = [
    'User', 'Role', 'Permission', 'Case', 'CaseCategory',
    'CaseParty', 'Party', 'Deadline', 'Activity', 'Document',
    'DocumentVersion', 'Meeting', 'MeetingActionItem', 'Proposal', 'ProposalVersion',
    'Report', 'ReportSection', 'ReportSectionVersion', 'Template', 'TemplateSection',
    'TemplateBlock', 'ApprovalRequest', 'ApprovalDecision', 'Contract', 'SuccessFee',
    'AIProvider', 'AIModel', 'AIPolicy', 'GenerationRun', 'GenerationSource',
    'SourceReference', 'AuditLog', 'Notification'
  ];
  for (const entity of all33Entities) {
    assert.ok(briefContent.includes(entity), `Product Brief missing entity: ${entity}`);
    assert.ok(scenariosContent.includes(entity), `Acceptance Scenarios / Traceability Matrix missing entity: ${entity}`);
  }

  // 9. Independent Normal Scenarios (12) + Failure/Rejection Scenarios (2)
  for (let i = 1; i <= 12; i++) {
    const sId = `SCENARIO-${i < 10 ? '0' + i : i}`;
    assert.ok(scenariosContent.includes(sId), `Missing normal scenario: ${sId}`);
  }
  assert.ok(scenariosContent.includes('FAIL-01'), 'Missing failure scenario: FAIL-01 (403)');
  assert.ok(scenariosContent.includes('FAIL-02'), 'Missing failure scenario: FAIL-02 (AI source missing)');
  const scenarioReferences = scenariosContent.match(/SCENARIO-\d{2}/g) ?? [];
  const allowedScenarioIds = new Set(Array.from({ length: 12 }, (_, index) => `SCENARIO-${String(index + 1).padStart(2, '0')}`));
  assert.deepStrictEqual(
    [...new Set(scenarioReferences.filter(reference => !allowedScenarioIds.has(reference)))],
    [],
    'Acceptance traceability must not reference undefined scenarios'
  );

  // 10. Reviewer Persona and RBAC Row-by-Row Cell Parser Assertion
  const rbacContent = fs.readFileSync(path.join(__dirname, '../docs/product/permissions-matrix.md'), 'utf8');
  const personasContent = fs.readFileSync(path.join(__dirname, '../docs/product/personas.md'), 'utf8');

  const getReviewerPermission = (rowTitle: string): string => {
    const lines = rbacContent.split('\n');
    for (const line of lines) {
      if (line.includes(rowTitle)) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
        if (cells.length >= 6) {
          return cells[5];
        }
      }
    }
    return '';
  };

  const uploadPerm = getReviewerPermission('자료/회의록 업로드');
  assert.ok(uploadPerm.startsWith('**O**') || uploadPerm.startsWith('O'), `RBAC Reviewer Upload must be O (found: ${uploadPerm})`);

  const editPerm = getReviewerPermission('보고서 초안 본문 직접 편집');
  assert.ok(editPerm.startsWith('**X**') || editPerm.startsWith('X'), `RBAC Reviewer Direct Edit must be X (found: ${editPerm})`);
  assert.strictEqual(editPerm.includes('O'), false, `RBAC Reviewer Direct Edit must NOT be O`);

  const approvePerm = getReviewerPermission('보고서 장 1차 승인 및 승인 취소');
  assert.ok(approvePerm.startsWith('**O**') || approvePerm.startsWith('O'), `RBAC Reviewer Approval must be O (found: ${approvePerm})`);

  const mergePerm = getReviewerPermission('최종 문서 DOCX/PDF 병합');
  assert.ok(mergePerm.startsWith('**X**') || mergePerm.startsWith('X'), `RBAC Reviewer Final Merge must be X (found: ${mergePerm})`);
  assert.strictEqual(mergePerm.includes('O'), false, `RBAC Reviewer Final Merge must NOT be O`);

  assert.ok(personasContent.includes('자료/회의록 업로드**: **허용 (O)**'), 'Personas must strictly specify Reviewer Upload = O');
  assert.ok(personasContent.includes('보고서 초안 본문 직접 편집**: **차단 (X)**'), 'Personas must strictly specify Reviewer Direct Edit = X');
  assert.ok(personasContent.includes('보고서 장(Section) 1차 승인 및 승인 취소**: **허용 (O)**'), 'Personas must strictly specify Reviewer Approval = O');
  assert.ok(personasContent.includes('최종 문서 DOCX/PDF 병합**: **차단 (X)**'), 'Personas must strictly specify Reviewer Final Merge = X');
});

test('P01 Manifest Integrity & Self-Assessment Assertions', () => {
  const p01ManifestPath = path.join(__dirname, '../artifacts/harness/P01/manifest.json');
  assert.strictEqual(fs.existsSync(p01ManifestPath), true, 'P01 manifest.json missing');

  const manifest = JSON.parse(fs.readFileSync(p01ManifestPath, 'utf8'));

  assert.strictEqual(manifest.phase, 'P01');
  assert.ok(Array.isArray(manifest.scope) && manifest.scope.length >= 5);
  assert.ok(Array.isArray(manifest.changedFiles), 'manifest.changedFiles must be an array');
  
  // Exact changedFiles array matching the sanitized P01 implementation commit (23 files)
  const expectedChangedFiles = [
    '.gitignore',
    '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md',
    '03_CLAIM_6_TYPE_TEMPLATE_MAPPING_SPEC.md',
    'artifacts/harness/P01/.gitkeep',
    'artifacts/harness/P01/commands.log',
    'artifacts/harness/P01/manifest.json',
    'artifacts/harness/P01/notes.md',
    'docs/domain/claim-types.yaml',
    'docs/product/acceptance-scenarios.md',
    'docs/product/navigation.md',
    'docs/product/non-goals.md',
    'docs/product/permissions-matrix.md',
    'docs/product/personas.md',
    'docs/product/product-brief.md',
    'docs/product/status-flows.md',
    'docs/templates/reference-inventory.json',
    'docs/templates/template-classification.yaml',
    'docs/templates/template-review-queue.yaml',
    'docs/templates/template-sensitivity-report.md',
    'scripts/anonymize-inventory.py',
    'scripts/gen-inventory.py',
    'scripts/scan-templates.py',
    'scripts/harness-test.ts'
  ];
  assert.deepStrictEqual([...manifest.changedFiles].sort(), expectedChangedFiles.sort(), 'P01 manifest.changedFiles must strictly match the exact commit diff files (23 files)');

  assert.ok(Array.isArray(manifest.commandsExecuted) && manifest.commandsExecuted.length >= 5);
  assert.strictEqual(manifest.tests.passed, 5, 'manifest.tests.passed must strictly be 5 for P01');
  assert.strictEqual(manifest.tests.failed, 0);
  assert.strictEqual(manifest.selfAssessment, 'READY_FOR_REVIEW');
});

test('Phase Status Machine Integration', () => {
  const phaseStatusPath: string = path.join(__dirname, '..', 'docs/harness/phase-status.json');
  const statusContent = JSON.parse(fs.readFileSync(phaseStatusPath, 'utf8'));
  assert.strictEqual(statusContent.project, 'claim-center-report-studio');
  assert.strictEqual(statusContent.phases.P00.status, 'PASS');
  assert.ok(statusContent.phases.P01);
});

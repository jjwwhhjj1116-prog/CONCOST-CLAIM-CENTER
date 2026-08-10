import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import initSqlJs from 'sql.js';
import { hashPassword, migrateDatabase } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';
import { startP13Isolated, closeP13Isolated } from './p13-test-support';
import { login, P09_TEST_ORIGIN, requestJson } from './p09-test-support';

const estimateBody = (expectedVersion: number, suffix: string, overrides: Record<string, unknown> = {}) => ({
  contractAmount: '100000000', baseAmount: '500000000', feeRateBps: 500,
  hasSuccessFee: true, billingDate: '2026-08-10', isTaxInclusive: false, calcType: 'ESTIMATED', expectedVersion,
  idempotencyKey: `SEC-ESTIMATE-${suffix}`, ...overrides
});

test('P13 additive invariant migration upgrades a database that already applied the original P13 migration', async () => {
  const root = path.resolve(__dirname, '..');
  const migrationsDir = path.join(root, 'packages/database/prisma/migrations');
  const originalName = '20260810110000_p13_fees_success_compensation';
  const invariantName = '20260810120000_p13_fee_invariants';
  const originalPath = path.join(migrationsDir, originalName, 'migration.sql');
  const originalSql = fs.readFileSync(originalPath, 'utf8');
  const canonicalOriginalSql = originalSql.replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(canonicalOriginalSql).digest('hex'), '8cd672c524c99f75a27adfd36ac9a43bab0261d0947165872ddbf252b1d5facf');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-p13-upgrade-'));
  const databasePath = path.join(tempDir, 'legacy.db');
  const uploadDir = path.join(tempDir, 'uploads');
  const upgradePasswordHash = hashPassword('Password123!', '0123456789abcdef0123456789abcdef');
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const legacy = new SQL.Database();
  try {
    legacy.run('PRAGMA foreign_keys = ON');
    legacy.run('CREATE TABLE IF NOT EXISTS "_P04Migration" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)');
    const priorMigrations = fs.readdirSync(migrationsDir)
      .filter((name) => name <= originalName && fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
      .sort();
    for (const name of priorMigrations) {
      const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
      legacy.run(sql);
      legacy.run('INSERT INTO "_P04Migration" ("name", "checksum", "appliedAt") VALUES (?, ?, ?)', [
        name,
        crypto.createHash('sha256').update(sql).digest('hex'),
        '2026-08-10T00:00:00.000Z'
      ]);
    }

    legacy.run(`INSERT INTO "Organization" ("id","name","updatedAt") VALUES ('ORG-P13-UPGRADE','P13 synthetic upgrade org','2026-08-10T00:00:00.000Z')`);
    legacy.run(`INSERT INTO "Role" ("id","name") VALUES ('pm','pm'),('director','director')`);
    legacy.run(`INSERT INTO "User" ("id","email","passwordHash","name","organizationId","updatedAt") VALUES
      ('USR-P13-UPGRADE-PM','p13-upgrade-pm@example.invalid','${upgradePasswordHash}','Synthetic PM','ORG-P13-UPGRADE','2026-08-10T00:00:00.000Z'),
      ('USR-P13-UPGRADE-DIRECTOR','p13-upgrade-director@example.invalid','${upgradePasswordHash}','Synthetic Director','ORG-P13-UPGRADE','2026-08-10T00:00:00.000Z')`);
    legacy.run(`INSERT INTO "UserRole" ("userId","roleId") VALUES ('USR-P13-UPGRADE-PM','pm'),('USR-P13-UPGRADE-DIRECTOR','director')`);
    legacy.run(`INSERT INTO "CaseItem" ("id","organizationId","title","claimType","version","updatedAt","caseNumber","description","status","assignedUserId") VALUES
      ('CASE-P13-UPGRADE-DRAFT','ORG-P13-UPGRADE','Synthetic populated draft','TYPE-01',1,'2026-08-10T00:00:00.000Z','P13-UPGRADE-001','synthetic only','SUCCESS_FEE','USR-P13-UPGRADE-PM'),
      ('CASE-P13-UPGRADE-CONFIRMED','ORG-P13-UPGRADE','Synthetic populated confirmed','TYPE-01',1,'2026-08-10T00:00:00.000Z','P13-UPGRADE-002','synthetic only','SUCCESS_FEE','USR-P13-UPGRADE-PM')`);
    legacy.run(`INSERT INTO "CaseAssignment" ("caseId","userId") VALUES
      ('CASE-P13-UPGRADE-DRAFT','USR-P13-UPGRADE-PM'),
      ('CASE-P13-UPGRADE-DRAFT','USR-P13-UPGRADE-DIRECTOR'),
      ('CASE-P13-UPGRADE-CONFIRMED','USR-P13-UPGRADE-PM'),
      ('CASE-P13-UPGRADE-CONFIRMED','USR-P13-UPGRADE-DIRECTOR')`);
    legacy.run(`INSERT INTO "CaseFeeConfig" ("id","organizationId","caseId","contractAmount","hasSuccessFee","baseAmount","feeRateBps","isTaxInclusive","status","version","createdAt","updatedAt") VALUES
      ('CFG-P13-UPGRADE-DRAFT','ORG-P13-UPGRADE','CASE-P13-UPGRADE-DRAFT',200,1,200,10000,0,'DRAFT',2,1786323600000,1786323720000),
      ('CFG-P13-UPGRADE-CONFIRMED','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED',300,1,300,10000,0,'CONFIRMED',3,1786327200000,1786327380000)`);
    legacy.run(`INSERT INTO "CaseFeeCalculation" ("id","organizationId","caseId","feeConfigId","calcType","contractAmount","baseAmount","feeRateBps","isTaxInclusive","calculatedFee","taxAmount","totalClaimFee","formulaVersion","actorId","idempotencyKey","createdAt") VALUES
      ('CALC-P13-UPGRADE-DRAFT-1','ORG-P13-UPGRADE','CASE-P13-UPGRADE-DRAFT','CFG-P13-UPGRADE-DRAFT','ESTIMATED',100,100,10000,0,100,10,110,'HALF_UP_BPS_V1','USR-P13-UPGRADE-PM','UPGRADE-DRAFT-1',1786323660000),
      ('CALC-P13-UPGRADE-DRAFT-2','ORG-P13-UPGRADE','CASE-P13-UPGRADE-DRAFT','CFG-P13-UPGRADE-DRAFT','ESTIMATED',200,200,10000,0,200,20,220,'HALF_UP_BPS_V1','USR-P13-UPGRADE-PM','UPGRADE-DRAFT-2',1786323720000),
      ('CALC-P13-UPGRADE-ESTIMATE','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED','CFG-P13-UPGRADE-CONFIRMED','ESTIMATED',300,300,10000,0,300,30,330,'HALF_UP_BPS_V1','USR-P13-UPGRADE-PM','UPGRADE-ESTIMATE',1786327260000),
      ('CALC-P13-UPGRADE-FINAL','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED','CFG-P13-UPGRADE-CONFIRMED','FINAL',300,300,10000,0,300,30,330,'HALF_UP_BPS_V1','USR-P13-UPGRADE-DIRECTOR','UPGRADE-FINAL',1786327320000)`);
    legacy.run(`INSERT INTO "CaseFeePayment" ("id","organizationId","caseId","feeConfigId","paymentType","amount","paymentDate","invoiceStatus","actorId","idempotencyKey","createdAt") VALUES
      ('PAY-P13-UPGRADE-1','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED','CFG-P13-UPGRADE-CONFIRMED','PARTIAL',100,1786327380000,'NOT_ISSUED','USR-P13-UPGRADE-PM','UPGRADE-PAYMENT',1786327380000)`);
    fs.writeFileSync(databasePath, Buffer.from(legacy.export()));
  } finally {
    legacy.close();
  }

  const assertUpgradeRejectedAndRolledBack = async (invalidPath: string) => {
    await assert.rejects(migrateDatabase(`file:${invalidPath}`), /CHECK constraint failed|_P13LegacyInvariantCheck/i);
    const rolledBack = new SQL.Database(fs.readFileSync(invalidPath));
    try {
      const applied = rolledBack.exec(`SELECT COUNT(*) FROM "_P04Migration" WHERE "name" = '${invariantName}'`)[0]?.values[0]?.[0];
      assert.equal(applied, 0);
      const columns = rolledBack.exec('PRAGMA table_info("CaseFeeCalculation")')[0]?.values.map((row) => String(row[1])) ?? [];
      assert.equal(columns.includes('sourceCalculationId'), false);
    } finally {
      rolledBack.close();
    }
  };

  const invalidScopePath = path.join(tempDir, 'legacy-cross-scope.db');
  fs.copyFileSync(databasePath, invalidScopePath);
  const invalidScope = new SQL.Database(fs.readFileSync(invalidScopePath));
  try {
    invalidScope.run(`INSERT INTO "Organization" ("id","name","updatedAt") VALUES ('ORG-P13-UPGRADE-B','P13 synthetic foreign org','2026-08-10T00:00:00.000Z')`);
    invalidScope.run(`INSERT INTO "User" ("id","email","passwordHash","name","organizationId","updatedAt") VALUES
      ('USR-P13-UPGRADE-B','p13-upgrade-b@example.invalid','${upgradePasswordHash}','Synthetic Foreign Actor','ORG-P13-UPGRADE-B','2026-08-10T00:00:00.000Z')`);
    invalidScope.run(`INSERT INTO "CaseFeeCalculation" ("id","organizationId","caseId","feeConfigId","calcType","contractAmount","baseAmount","feeRateBps","isTaxInclusive","calculatedFee","taxAmount","totalClaimFee","formulaVersion","actorId","idempotencyKey","createdAt") VALUES
      ('CALC-P13-UPGRADE-CROSS-SCOPE','ORG-P13-UPGRADE','CASE-P13-UPGRADE-DRAFT','CFG-P13-UPGRADE-DRAFT','ESTIMATED',200,200,10000,0,200,20,220,'HALF_UP_BPS_V1','USR-P13-UPGRADE-B','UPGRADE-CROSS-SCOPE',1786323780000)`);
    fs.writeFileSync(invalidScopePath, Buffer.from(invalidScope.export()));
  } finally {
    invalidScope.close();
  }
  await assertUpgradeRejectedAndRolledBack(invalidScopePath);

  const invalidForgedV3Path = path.join(tempDir, 'legacy-forged-v3.db');
  fs.copyFileSync(databasePath, invalidForgedV3Path);
  const invalidForgedV3 = new SQL.Database(fs.readFileSync(invalidForgedV3Path));
  try {
    invalidForgedV3.run(`INSERT INTO "CaseFeeCalculation" ("id","organizationId","caseId","feeConfigId","calcType","contractAmount","baseAmount","feeRateBps","isTaxInclusive","calculatedFee","taxAmount","totalClaimFee","formulaVersion","actorId","idempotencyKey","createdAt") VALUES
      ('CALC-P13-UPGRADE-FORGED-V3-ESTIMATE','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED','CFG-P13-UPGRADE-CONFIRMED','ESTIMATED',300,300,10000,0,999,0,999,'KRW_INTEGER_HALF_UP_BPS_TAX_V3','USR-P13-UPGRADE-PM','UPGRADE-FORGED-V3-ESTIMATE',1786327440000),
      ('CALC-P13-UPGRADE-FORGED-V3-FINAL','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED','CFG-P13-UPGRADE-CONFIRMED','FINAL',300,300,10000,0,999,0,999,'KRW_INTEGER_HALF_UP_BPS_TAX_V3','USR-P13-UPGRADE-DIRECTOR','UPGRADE-FORGED-V3-FINAL',1786327500000)`);
    fs.writeFileSync(invalidForgedV3Path, Buffer.from(invalidForgedV3.export()));
  } finally {
    invalidForgedV3.close();
  }
  await assertUpgradeRejectedAndRolledBack(invalidForgedV3Path);

  const invalidAdjustmentPath = path.join(tempDir, 'legacy-adjustment.db');
  fs.copyFileSync(databasePath, invalidAdjustmentPath);
  const invalidAdjustment = new SQL.Database(fs.readFileSync(invalidAdjustmentPath));
  try {
    invalidAdjustment.run(`INSERT INTO "CaseFeePayment" ("id","organizationId","caseId","feeConfigId","paymentType","amount","paymentDate","invoiceStatus","actorId","idempotencyKey","createdAt") VALUES
      ('PAY-P13-UPGRADE-ADJUSTMENT','ORG-P13-UPGRADE','CASE-P13-UPGRADE-CONFIRMED','CFG-P13-UPGRADE-CONFIRMED','ADJUSTMENT',1,1786327440000,'NOT_ISSUED','USR-P13-UPGRADE-PM','UPGRADE-ADJUSTMENT',1786327440000)`);
    fs.writeFileSync(invalidAdjustmentPath, Buffer.from(invalidAdjustment.export()));
  } finally {
    invalidAdjustment.close();
  }
  await assertUpgradeRejectedAndRolledBack(invalidAdjustmentPath);

  try {
    await migrateDatabase(`file:${databasePath}`);
    const upgraded = new SQL.Database(fs.readFileSync(databasePath));
    try {
      const applied = upgraded.exec(`SELECT "name" FROM "_P04Migration" WHERE "name" = '${invariantName}'`);
      assert.equal(applied[0]?.values[0]?.[0], invariantName);
      const columns = upgraded.exec('PRAGMA table_info("CaseFeeCalculation")')[0]?.values.map((row) => String(row[1])) ?? [];
      assert.equal(columns.includes('sourceCalculationId'), true);
      assert.equal(columns.includes('idempotencyFingerprint'), true);
      assert.equal(columns.includes('hasSuccessFee'), true);
      assert.equal(columns.includes('billingDate'), true);
      assert.equal(columns.includes('feeConfigVersion'), true);
      const paymentColumns = upgraded.exec('PRAGMA table_info("CaseFeePayment")')[0]?.values.map((row) => String(row[1])) ?? [];
      assert.equal(paymentColumns.includes('idempotencyFingerprint'), true);
      const triggers = new Set(upgraded.exec("SELECT name FROM sqlite_master WHERE type = 'trigger'")[0]?.values.flat().map(String) ?? []);
      for (const name of [
        'trg_scope_CaseFeeConfig', 'trg_scope_CaseFeeCalculation', 'trg_scope_CaseFeePayment', 'trg_scope_CaseFeeAudit',
        'trg_guard_terms_CaseFeeCalculation', 'trg_guard_final_CaseFeeCalculation', 'trg_confirm_CaseFeeConfig_after_final',
        'trg_guard_input_CaseFeePayment', 'trg_guard_balance_CaseFeePayment',
        'trg_guard_closed_CaseFeeConfig_insert', 'trg_guard_closed_CaseFeeConfig_update',
        'trg_guard_closed_CaseFeeCalculation', 'trg_guard_closed_CaseFeePayment', 'trg_block_update_CaseFeeCalculation'
      ]) assert.equal(triggers.has(name), true, `Missing upgraded trigger ${name}`);
      const indexes = new Set(upgraded.exec("SELECT name FROM sqlite_master WHERE type = 'index'")[0]?.values.flat().map(String) ?? []);
      assert.equal(indexes.has('CaseFeeCalculation_idempotencyKey_key'), false);
      assert.equal(indexes.has('CaseFeePayment_idempotencyKey_key'), false);
      assert.equal(indexes.has('CaseFeeCalculation_organizationId_caseId_actorId_idempotencyKey_key'), true);
      assert.equal(indexes.has('CaseFeePayment_organizationId_caseId_actorId_idempotencyKey_key'), true);
      const versionRows = upgraded.exec('SELECT "id", "feeConfigVersion", "formulaVersion", "sourceCalculationId" FROM "CaseFeeCalculation" WHERE "organizationId" = \'ORG-P13-UPGRADE\' ORDER BY "id"')[0]?.values ?? [];
      assert.deepEqual(versionRows, [
        ['CALC-P13-UPGRADE-DRAFT-1', 1, 'HALF_UP_BPS_V1', null],
        ['CALC-P13-UPGRADE-DRAFT-2', 2, 'HALF_UP_BPS_V1', null],
        ['CALC-P13-UPGRADE-ESTIMATE', 1, 'HALF_UP_BPS_V1', null],
        ['CALC-P13-UPGRADE-FINAL', 1, 'HALF_UP_BPS_V1', 'CALC-P13-UPGRADE-ESTIMATE']
      ]);
      const quarantinedConfig = upgraded.exec(`SELECT "status", "version" FROM "CaseFeeConfig" WHERE "id" = 'CFG-P13-UPGRADE-CONFIRMED'`)[0]?.values[0] ?? [];
      assert.deepEqual(quarantinedConfig, ['DRAFT', 4]);
      const paymentCount = upgraded.exec(`SELECT COUNT(*) FROM "CaseFeePayment" WHERE "id" = 'PAY-P13-UPGRADE-1'`)[0]?.values[0]?.[0];
      assert.equal(paymentCount, 1);
      assert.throws(() => upgraded.run(`UPDATE "CaseFeeCalculation" SET "taxAmount" = 999 WHERE "id" = 'CALC-P13-UPGRADE-DRAFT-1'`), /append-only/i);
    } finally {
      upgraded.close();
    }

    const api = createApiServer({ databaseUrl: `file:${databasePath}`, allowedOrigins: [P09_TEST_ORIGIN], secureCookies: false, uploadDir });
    await new Promise<void>((resolve, reject) => api.once('error', reject).listen(0, '127.0.0.1', resolve));
    const apiOrigin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    try {
      const [pm, director] = await Promise.all([
        login(apiOrigin, 'p13-upgrade-pm@example.invalid'),
        login(apiOrigin, 'p13-upgrade-director@example.invalid')
      ]);
      const quarantinedSummary = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-CONFIRMED/fee-compensation', 'GET', undefined, pm);
      assert.equal(quarantinedSummary.status, 200);
      assert.equal(quarantinedSummary.body.summary.status, 'DRAFT');
      assert.equal(quarantinedSummary.body.summary.confirmedFee, '0');
      assert.equal(quarantinedSummary.body.summary.totalPaid, '100');

      const legacyPayment = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-CONFIRMED/fee-compensation/payments', 'POST', {
        amount: '1', paymentDate: '2026-08-10', paymentType: 'PARTIAL', invoiceStatus: 'NOT_ISSUED',
        expectedVersion: 4, idempotencyKey: 'UPGRADE-LEGACY-PAYMENT-BLOCKED'
      }, pm);
      assert.equal(legacyPayment.status, 409);
      const legacyClose = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-CONFIRMED/close-with-unpaid-check', 'POST', {
        forceClose: false, caseVersion: 1, feeVersion: 4
      }, pm);
      assert.equal(legacyClose.status, 409);

      const legacyFinalize = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-DRAFT/fee-compensation/finalize', 'POST', {
        calculationId: 'CALC-P13-UPGRADE-DRAFT-2', expectedVersion: 2, idempotencyKey: 'UPGRADE-LEGACY-FINAL'
      }, director);
      assert.equal(legacyFinalize.status, 409);
      assert.match(String(legacyFinalize.body.error), /recalculated with the current formula/i);

      const recalculated = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-DRAFT/fee-compensation/calculate', 'POST', {
        contractAmount: '200', baseAmount: '200', feeRateBps: 10000, hasSuccessFee: true,
        billingDate: '2026-08-10', isTaxInclusive: false, calcType: 'ESTIMATED',
        expectedVersion: 2, idempotencyKey: 'UPGRADE-V3-ESTIMATE'
      }, pm);
      assert.equal(recalculated.status, 201);
      const finalized = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-DRAFT/fee-compensation/finalize', 'POST', {
        calculationId: recalculated.body.calculation.id, expectedVersion: 3, idempotencyKey: 'UPGRADE-V3-FINAL'
      }, director);
      assert.equal(finalized.status, 201, JSON.stringify(finalized.body));
      assert.equal(finalized.body.calculation.formulaVersion, 'KRW_INTEGER_HALF_UP_BPS_TAX_V3');

      const refreshedEstimate = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-CONFIRMED/fee-compensation/calculate', 'POST', {
        contractAmount: '300', baseAmount: '300', feeRateBps: 10000, hasSuccessFee: true,
        billingDate: '2026-08-10', isTaxInclusive: false, calcType: 'ESTIMATED',
        expectedVersion: 4, idempotencyKey: 'UPGRADE-CONFIRMED-V3-ESTIMATE'
      }, pm);
      assert.equal(refreshedEstimate.status, 201, JSON.stringify(refreshedEstimate.body));
      const refreshedFinal = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-CONFIRMED/fee-compensation/finalize', 'POST', {
        calculationId: refreshedEstimate.body.calculation.id, expectedVersion: 5, idempotencyKey: 'UPGRADE-CONFIRMED-V3-FINAL'
      }, director);
      assert.equal(refreshedFinal.status, 201, JSON.stringify(refreshedFinal.body));
      const refreshedSummary = await requestJson(apiOrigin, '/api/cases/CASE-P13-UPGRADE-CONFIRMED/fee-compensation', 'GET', undefined, pm);
      assert.equal(refreshedSummary.body.summary.status, 'CONFIRMED');
      assert.equal(refreshedSummary.body.summary.version, 6);
      assert.equal(refreshedSummary.body.summary.confirmedFee, '330');
      assert.equal(refreshedSummary.body.summary.totalPaid, '100');
      assert.equal(refreshedSummary.body.summary.unpaidBalance, '230');
    } finally {
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await api.waitForDatabaseClose();
    }

    const verified = new SQL.Database(fs.readFileSync(databasePath));
    try {
      const finalRows = verified.exec(`SELECT "formulaVersion" FROM "CaseFeeCalculation" WHERE "caseId" = 'CASE-P13-UPGRADE-DRAFT' AND "calcType" = 'FINAL'`)[0]?.values ?? [];
      assert.deepEqual(finalRows, [['KRW_INTEGER_HALF_UP_BPS_TAX_V3']]);
      const upgradedConfig = verified.exec(`SELECT "status", "version" FROM "CaseFeeConfig" WHERE "id" = 'CFG-P13-UPGRADE-DRAFT'`)[0]?.values[0] ?? [];
      assert.deepEqual(upgradedConfig, ['CONFIRMED', 4]);
      const refreshedLegacyConfig = verified.exec(`SELECT "status", "version" FROM "CaseFeeConfig" WHERE "id" = 'CFG-P13-UPGRADE-CONFIRMED'`)[0]?.values[0] ?? [];
      assert.deepEqual(refreshedLegacyConfig, ['CONFIRMED', 6]);
    } finally {
      verified.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('P13 adversarial security suite', async () => {
  const context = await startP13Isolated('p13-security');
  const { origin, db, fixture, foreignSession, adminSession, staffSession, reviewerSession, pmSession, directorSession, ceoSession } = context;
  const report = await db.report.findUniqueOrThrow({ where: { id: fixture.reportId } });
  const caseId = report.caseId;
  let latestEstimateId = '';

  try {
    await test('1. negative, malformed, unsafe-number and over-limit inputs return 400', async () => {
      for (const overrides of [
        { contractAmount: '-1' }, { baseAmount: '1.5' }, { contractAmount: Number.MAX_SAFE_INTEGER + 1 },
        { feeRateBps: -1 }, { feeRateBps: 10001 }, { feeRateBps: 1.5 }
      ]) {
        const response = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimateBody(0, `BAD-${JSON.stringify(overrides)}`, overrides), pmSession);
        assert.equal(response.status, 400);
      }
    });

    await test('2. maximum amount, inclusive tax and half-up boundary use exact integer math', async () => {
      const zero = await requestJson(origin, '/api/cases/CASE-SYN-004/fee-compensation/calculate', 'POST', estimateBody(0, 'BOUNDARY', {
        contractAmount: '9000000000000000', baseAmount: '110000', feeRateBps: 10000, isTaxInclusive: true
      }), pmSession);
      assert.equal(zero.status, 201);
      assert.equal(zero.body.calculation.calculatedFee, '100000');
      assert.equal(zero.body.calculation.taxAmount, '10000');
      assert.equal(zero.body.calculation.totalClaimFee, '110000');

      const exclusive = await requestJson(origin, '/api/cases/CASE-SYN-004/fee-compensation/calculate', 'POST', estimateBody(1, 'VAT-HALF-UP', {
        contractAmount: '15', baseAmount: '15', feeRateBps: 10000, isTaxInclusive: false
      }), pmSession);
      assert.equal(exclusive.status, 201);
      assert.equal(exclusive.body.calculation.calculatedFee, '15');
      assert.equal(exclusive.body.calculation.taxAmount, '2');
      assert.equal(exclusive.body.calculation.totalClaimFee, '17');
      await assert.rejects(
        db.$executeRawUnsafe(`
          INSERT INTO "CaseFeeCalculation" (
            "id", "organizationId", "caseId", "feeConfigId", "calcType", "contractAmount",
            "hasSuccessFee", "billingDate", "baseAmount", "feeRateBps", "isTaxInclusive",
            "calculatedFee", "taxAmount", "totalClaimFee", "formulaVersion", "feeConfigVersion",
            "sourceCalculationId", "actorId", "idempotencyKey", "idempotencyFingerprint", "createdAt"
          )
          SELECT 'CALC-P13-BAD-VAT', "organizationId", "caseId", "feeConfigId", "calcType", "contractAmount",
            "hasSuccessFee", "billingDate", "baseAmount", "feeRateBps", "isTaxInclusive",
            "calculatedFee", 1, 16, "formulaVersion", "feeConfigVersion",
            NULL, "actorId", 'BAD-VAT', 'BAD-VAT', "createdAt"
          FROM "CaseFeeCalculation" WHERE "id" = ?
        `, exclusive.body.calculation.id),
        /CaseFeeCalculation terms or integer formula mismatch/i
      );
    });

    await test('3. scoped idempotency replays identical payload and rejects mismatches', async () => {
      const body = estimateBody(0, 'MAIN');
      const created = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', body, pmSession);
      assert.equal(created.status, 201);
      latestEstimateId = created.body.calculation.id;
      const replay = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', body, pmSession);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.idempotentReplay, true);
      const mismatch = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', { ...body, baseAmount: '500000001' }, pmSession);
      assert.equal(mismatch.status, 409);

      const concurrentBody = estimateBody(2, 'RACE-CALCULATE', { baseAmount: '110001' });
      const concurrent = await Promise.all([
        requestJson(origin, '/api/cases/CASE-SYN-004/fee-compensation/calculate', 'POST', concurrentBody, pmSession),
        requestJson(origin, '/api/cases/CASE-SYN-004/fee-compensation/calculate', 'POST', concurrentBody, pmSession)
      ]);
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 201]);
      assert.equal(concurrent[0].body.calculation.id, concurrent[1].body.calculation.id);
      assert.equal(await db.caseFeeCalculation.count({ where: { caseId: 'CASE-SYN-004', idempotencyKey: concurrentBody.idempotencyKey } }), 1);
      const concurrentMismatch = await requestJson(origin, '/api/cases/CASE-SYN-004/fee-compensation/calculate', 'POST', { ...concurrentBody, baseAmount: '110002' }, pmSession);
      assert.equal(concurrentMismatch.status, 409);
    });

    await test('4. rate changes append history and preserve earlier calculations', async () => {
      const changed = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimateBody(1, 'RATE-CHANGE', { feeRateBps: 501 }), pmSession);
      assert.equal(changed.status, 201);
      latestEstimateId = changed.body.calculation.id;
      const rows = await db.caseFeeCalculation.findMany({ where: { caseId, calcType: 'ESTIMATED' }, orderBy: { createdAt: 'asc' } });
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.feeRateBps), [500, 501]);
    });

    await test('5. PM, Admin, Staff and Reviewer cannot exceed the P13 product role matrix', async () => {
      const pmApproval = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/finalize`, 'POST', { calculationId: latestEstimateId, expectedVersion: 2, idempotencyKey: 'SEC-PM-FINALIZE-01' }, pmSession);
      assert.equal(pmApproval.status, 403);
      const staffMutation = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimateBody(2, 'STAFF'), staffSession);
      assert.equal(staffMutation.status, 403);
      const reviewerMutation = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', { amount: '1', paymentDate: '2026-08-10', paymentType: 'PARTIAL', invoiceStatus: 'NOT_ISSUED', expectedVersion: 2 }, reviewerSession);
      assert.equal(reviewerMutation.status, 403);
      const adminMutation = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimateBody(2, 'ADMIN'), adminSession);
      assert.equal(adminMutation.status, 403);
    });

    await test('6. final approval is independent and blocks author self-approval', async () => {
      const directorEstimate = await requestJson(origin, '/api/cases/CASE-SYN-SAME-1/fee-compensation/calculate', 'POST', estimateBody(0, 'DIRECTOR-AUTHOR'), directorSession);
      assert.equal(directorEstimate.status, 201);
      const selfApproval = await requestJson(origin, '/api/cases/CASE-SYN-SAME-1/fee-compensation/finalize', 'POST', { calculationId: directorEstimate.body.calculation.id, expectedVersion: 1, idempotencyKey: 'SEC-DIRECTOR-SELF-01' }, directorSession);
      assert.equal(selfApproval.status, 403);
      const finalBody = { calculationId: latestEstimateId, expectedVersion: 2, idempotencyKey: 'SEC-DIRECTOR-FINAL-01' };
      const final = await Promise.all([
        requestJson(origin, `/api/cases/${caseId}/fee-compensation/finalize`, 'POST', finalBody, directorSession),
        requestJson(origin, `/api/cases/${caseId}/fee-compensation/finalize`, 'POST', finalBody, directorSession)
      ]);
      assert.deepEqual(final.map((response) => response.status).sort(), [200, 201]);
      assert.equal(final[0].body.calculation.id, final[1].body.calculation.id);
      assert.equal(await db.caseFeeCalculation.count({ where: { caseId, calcType: 'FINAL', idempotencyKey: finalBody.idempotencyKey } }), 1);
      const finalMismatch = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/finalize`, 'POST', { ...finalBody, expectedVersion: 3 }, directorSession);
      assert.equal(finalMismatch.status, 409);
    });

    await test('7. cross-tenant and unassigned-case reads and writes are denied', async () => {
      const foreignRead = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, foreignSession);
      assert.equal(foreignRead.status, 404);
      const foreignWrite = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimateBody(0, 'FOREIGN'), foreignSession);
      assert.equal(foreignWrite.status, 404);
      const unassigned = await requestJson(origin, '/api/cases/CASE-SYN-003/fee-compensation', 'GET', undefined, pmSession);
      assert.equal(unassigned.status, 403);
      const unassignedDirector = await requestJson(origin, '/api/cases/CASE-SYN-003/fee-compensation', 'GET', undefined, directorSession);
      assert.equal(unassignedDirector.status, 403);
      const unassignedCeo = await requestJson(origin, '/api/cases/CASE-SYN-003/fee-compensation', 'GET', undefined, ceoSession);
      assert.equal(unassignedCeo.status, 403);
    });

    await test('7b. a PM can explicitly assign one same-tenant independent approver without a DB fixture', async () => {
      const created = await requestJson(origin, '/api/cases', 'POST', {
        title: 'SYNTHETIC_P13_APPROVER_WORKFLOW', claimType: 'TYPE-01', description: 'synthetic only',
        category: { major: 'Synthetic', middle: 'P13', minor: 'Approval' }
      }, pmSession);
      assert.equal(created.status, 201);
      const newCaseId = created.body.case.id as string;

      const before = await requestJson(origin, `/api/cases/${newCaseId}/fee-compensation`, 'GET', undefined, directorSession);
      assert.equal(before.status, 403);
      const candidates = await requestJson(origin, `/api/cases/${newCaseId}/fee-approvers?q=director`, 'GET', undefined, pmSession);
      assert.equal(candidates.status, 200);
      assert.equal(candidates.body.approvers.some((item: { id: string; assigned: boolean }) => item.id === 'USR-DIRECTOR' && !item.assigned), true);

      const invalidRole = await requestJson(origin, `/api/cases/${newCaseId}/fee-approvers`, 'POST', { userId: 'USR-STAFF', expectedCaseVersion: 1 }, pmSession);
      assert.equal(invalidRole.status, 400);
      const crossTenant = await requestJson(origin, `/api/cases/${newCaseId}/fee-approvers`, 'POST', { userId: 'USR-ORGB-PM', expectedCaseVersion: 1 }, pmSession);
      assert.equal(crossTenant.status, 400);

      const assigned = await requestJson(origin, `/api/cases/${newCaseId}/fee-approvers`, 'POST', { userId: 'USR-DIRECTOR', expectedCaseVersion: 1 }, pmSession);
      assert.equal(assigned.status, 201);
      const replay = await requestJson(origin, `/api/cases/${newCaseId}/fee-approvers`, 'POST', { userId: 'USR-DIRECTOR', expectedCaseVersion: 1 }, pmSession);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.idempotentReplay, true);
      const staleDifferentApprover = await requestJson(origin, `/api/cases/${newCaseId}/fee-approvers`, 'POST', { userId: 'USR-CEO', expectedCaseVersion: 1 }, pmSession);
      assert.equal(staleDifferentApprover.status, 409);
      const after = await requestJson(origin, `/api/cases/${newCaseId}/fee-compensation`, 'GET', undefined, directorSession);
      assert.equal(after.status, 200);
      assert.equal(await db.caseAssignment.count({ where: { caseId: newCaseId, userId: 'USR-DIRECTOR' } }), 1);
      assert.equal(await db.caseAssignment.count({ where: { caseId: newCaseId, userId: 'USR-CEO' } }), 0);
      assert.equal(await db.auditLog.count({ where: { targetEntity: 'CaseAssignment', targetId: `${newCaseId}:USR-DIRECTOR`, action: 'FEE_APPROVER_ASSIGNED' } }), 1);

      const concurrentCase = await requestJson(origin, '/api/cases', 'POST', {
        title: 'SYNTHETIC_P13_CONCURRENT_APPROVER', claimType: 'TYPE-01', description: 'synthetic only',
        category: { major: 'Synthetic', middle: 'P13', minor: 'Concurrent approval' }
      }, pmSession);
      assert.equal(concurrentCase.status, 201);
      const concurrentCaseId = concurrentCase.body.case.id as string;
      const concurrent = await Promise.all([
        requestJson(origin, `/api/cases/${concurrentCaseId}/fee-approvers`, 'POST', { userId: 'USR-DIRECTOR', expectedCaseVersion: 1 }, pmSession),
        requestJson(origin, `/api/cases/${concurrentCaseId}/fee-approvers`, 'POST', { userId: 'USR-CEO', expectedCaseVersion: 1 }, pmSession)
      ]);
      assert.deepEqual(concurrent.map((response) => response.status).sort((a, b) => a - b), [201, 409]);
      assert.equal(await db.caseAssignment.count({ where: { caseId: concurrentCaseId, userId: { in: ['USR-DIRECTOR', 'USR-CEO'] } } }), 1);
    });

    await test('8. stale versions and concurrent calculation attempts return 409', async () => {
      const first = await requestJson(origin, '/api/cases/CASE-SYN-SAME-2/fee-compensation/calculate', 'POST', estimateBody(0, 'CONCURRENT-A'), pmSession);
      assert.equal(first.status, 201);
      const stale = await requestJson(origin, '/api/cases/CASE-SYN-SAME-2/fee-compensation/calculate', 'POST', estimateBody(0, 'CONCURRENT-B'), pmSession);
      assert.equal(stale.status, 409);
    });

    await test('9. zero, negative, overpayment and incomplete invoice metadata are rejected', async () => {
      const state = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
      for (const [amount, extra, status] of [
        ['0', {}, 400], ['-1', {}, 400], ['999999999', {}, 409],
        ['1', { invoiceStatus: 'ISSUED', invoiceNumber: '' }, 400]
      ] as const) {
        const response = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', {
          amount, paymentType: 'PARTIAL', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
          expectedVersion: state.body.summary.version, idempotencyKey: `SEC-BAD-PAY-${status}-${amount.replace('-', 'N')}`, ...extra
        }, pmSession);
        assert.equal(response.status, status);
      }
    });

    await test('10. AuditLog failure rolls back payment and optimistic projection atomically', async () => {
      const before = await db.caseFeeConfig.findUniqueOrThrow({ where: { caseId } });
      const countBefore = await db.caseFeePayment.count({ where: { caseId } });
      await db.$executeRawUnsafe(`CREATE TRIGGER "trg_p13_test_fail_audit" BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'FEE_PAYMENT_RECORDED' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
      const failed = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', {
        amount: '1', paymentType: 'PARTIAL', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
        expectedVersion: before.version, idempotencyKey: 'SEC-AUDIT-ROLLBACK-01'
      }, pmSession);
      assert.equal(failed.status, 500);
      await db.$executeRawUnsafe('DROP TRIGGER "trg_p13_test_fail_audit"');
      assert.equal(await db.caseFeePayment.count({ where: { caseId } }), countBefore);
      assert.equal((await db.caseFeeConfig.findUniqueOrThrow({ where: { caseId } })).version, before.version);

      const validBody = {
        amount: '1', paymentType: 'PARTIAL', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
        expectedVersion: before.version, idempotencyKey: 'SEC-VALID-PAYMENT-01'
      };
      const valid = await Promise.all([
        requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', validBody, pmSession),
        requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', validBody, pmSession)
      ]);
      assert.deepEqual(valid.map((response) => response.status).sort(), [200, 201]);
      assert.equal(valid[0].body.payment.id, valid[1].body.payment.id);
      assert.equal(await db.caseFeePayment.count({ where: { caseId, idempotencyKey: validBody.idempotencyKey } }), 1);
      const paymentMismatch = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', { ...validBody, amount: '2' }, pmSession);
      assert.equal(paymentMismatch.status, 409);
    });

    await test('11. calculation, payment and fee audit rows are append-only', async () => {
      for (const table of ['CaseFeeCalculation', 'CaseFeePayment', 'CaseFeeAudit']) {
        await assert.rejects(db.$executeRawUnsafe(`UPDATE "${table}" SET "createdAt" = CURRENT_TIMESTAMP WHERE "caseId" = '${caseId}'`));
        await assert.rejects(db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "caseId" = '${caseId}'`));
      }
    });

    await test('12. DB triggers reject cross-scope rows, self-approval, overpayment and confirmed-term mutation', async () => {
      const config = await db.caseFeeConfig.findUniqueOrThrow({ where: { caseId } });
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "CaseFeeCalculation" ("id","organizationId","caseId","feeConfigId","calcType","contractAmount","hasSuccessFee","billingDate","baseAmount","feeRateBps","isTaxInclusive","calculatedFee","taxAmount","totalClaimFee","formulaVersion","feeConfigVersion","actorId","createdAt") VALUES ('SYNTHETIC-CROSS-SCOPE','ORG-SYN-A','CASE-SYN-004','${config.id}','ESTIMATED',0,1,CURRENT_TIMESTAMP,0,0,0,0,0,0,'TEST',1,'USR-PM',CURRENT_TIMESTAMP)`));
      await assert.rejects(db.caseFeeConfig.update({ where: { id: config.id }, data: { feeRateBps: 999 } }));
      await assert.rejects(db.caseFeePayment.create({ data: {
        id: 'SYNTHETIC-RAW-OVERPAY', organizationId: 'ORG-SYN-A', caseId, feeConfigId: config.id,
        paymentType: 'PARTIAL', amount: 999_999_999n, paymentDate: new Date('2026-08-10T00:00:00.000Z'),
        invoiceStatus: 'NOT_ISSUED', actorId: 'USR-PM'
      } }));
      const directorEstimate = await db.caseFeeCalculation.findFirstOrThrow({ where: { caseId: 'CASE-SYN-SAME-1', calcType: 'ESTIMATED' } });
      await assert.rejects(db.caseFeeCalculation.create({ data: {
        id: 'SYNTHETIC-RAW-SELF-FINAL', organizationId: directorEstimate.organizationId,
        caseId: directorEstimate.caseId, feeConfigId: directorEstimate.feeConfigId, calcType: 'FINAL',
        contractAmount: directorEstimate.contractAmount, hasSuccessFee: directorEstimate.hasSuccessFee,
        billingDate: directorEstimate.billingDate, baseAmount: directorEstimate.baseAmount,
        feeRateBps: directorEstimate.feeRateBps, isTaxInclusive: directorEstimate.isTaxInclusive,
        calculatedFee: directorEstimate.calculatedFee, taxAmount: directorEstimate.taxAmount,
        totalClaimFee: directorEstimate.totalClaimFee, formulaVersion: directorEstimate.formulaVersion,
        feeConfigVersion: directorEstimate.feeConfigVersion,
        sourceCalculationId: directorEstimate.id, actorId: directorEstimate.actorId
      } }));

      const draftEstimate = await db.caseFeeCalculation.findFirstOrThrow({ where: { caseId: 'CASE-SYN-SAME-2', calcType: 'ESTIMATED' } });
      const draftConfig = await db.caseFeeConfig.findUniqueOrThrow({ where: { id: draftEstimate.feeConfigId } });
      await assert.rejects(db.caseFeeCalculation.create({ data: {
        id: 'SYNTHETIC-FORGED-ESTIMATE', organizationId: draftEstimate.organizationId,
        caseId: draftEstimate.caseId, feeConfigId: draftEstimate.feeConfigId, calcType: 'ESTIMATED',
        contractAmount: draftConfig.contractAmount, hasSuccessFee: draftConfig.hasSuccessFee,
        billingDate: draftConfig.billingDate, baseAmount: draftConfig.baseAmount,
        feeRateBps: draftConfig.feeRateBps, isTaxInclusive: draftConfig.isTaxInclusive,
        calculatedFee: draftEstimate.calculatedFee + 1n, taxAmount: draftEstimate.taxAmount,
        totalClaimFee: draftEstimate.totalClaimFee + 1n, formulaVersion: 'FORGED',
        feeConfigVersion: draftConfig.version, actorId: 'USR-PM'
      } }));
      await assert.rejects(db.caseFeeCalculation.create({ data: {
        id: 'SYNTHETIC-FORGED-FINAL', organizationId: draftEstimate.organizationId,
        caseId: draftEstimate.caseId, feeConfigId: draftEstimate.feeConfigId, calcType: 'FINAL',
        contractAmount: draftEstimate.contractAmount, hasSuccessFee: draftEstimate.hasSuccessFee,
        billingDate: draftEstimate.billingDate, baseAmount: draftEstimate.baseAmount,
        feeRateBps: draftEstimate.feeRateBps, isTaxInclusive: draftEstimate.isTaxInclusive,
        calculatedFee: draftEstimate.calculatedFee + 1n, taxAmount: draftEstimate.taxAmount,
        totalClaimFee: draftEstimate.totalClaimFee + 1n, formulaVersion: 'FORGED',
        feeConfigVersion: draftEstimate.feeConfigVersion, sourceCalculationId: draftEstimate.id,
        actorId: 'USR-DIRECTOR'
      } }));
      for (const [id, actorId] of [
        ['SYNTHETIC-STAFF-FINAL', 'USR-STAFF'],
        ['SYNTHETIC-UNASSIGNED-CEO-FINAL', 'USR-CEO']
      ] as const) {
        await assert.rejects(db.caseFeeCalculation.create({ data: {
          id, organizationId: draftEstimate.organizationId,
          caseId: draftEstimate.caseId, feeConfigId: draftEstimate.feeConfigId, calcType: 'FINAL',
          contractAmount: draftEstimate.contractAmount, hasSuccessFee: draftEstimate.hasSuccessFee,
          billingDate: draftEstimate.billingDate, baseAmount: draftEstimate.baseAmount,
          feeRateBps: draftEstimate.feeRateBps, isTaxInclusive: draftEstimate.isTaxInclusive,
          calculatedFee: draftEstimate.calculatedFee, taxAmount: draftEstimate.taxAmount,
          totalClaimFee: draftEstimate.totalClaimFee, formulaVersion: draftEstimate.formulaVersion,
          feeConfigVersion: draftEstimate.feeConfigVersion, sourceCalculationId: draftEstimate.id,
          actorId
        } }));
      }
      assert.equal((await db.caseFeeConfig.findUniqueOrThrow({ where: { id: draftConfig.id } })).status, 'DRAFT');
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "CaseFeeConfig" SET "organizationId" = 'ORG-SYN-B', "version" = "version" + 1 WHERE "id" = '${draftConfig.id}'`));
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "CaseFeeConfig" SET "contractAmount" = "contractAmount" + 1, "status" = 'CONFIRMED', "version" = "version" + 1 WHERE "id" = '${draftConfig.id}'`));
    });

    await test('13. unpaid closure bypass and PM forced closure are blocked', async () => {
      await db.caseItem.update({ where: { id: caseId }, data: { status: 'SUCCESS_FEE', version: { increment: 1 } } });
      const state = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
      const normal = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', { forceClose: false, caseVersion: state.body.summary.caseVersion, feeVersion: state.body.summary.version }, pmSession);
      assert.equal(normal.status, 409);
      const forced = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', { forceClose: true, caseVersion: state.body.summary.caseVersion, feeVersion: state.body.summary.version }, pmSession);
      assert.equal(forced.status, 403);
      const directorForced = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', { forceClose: true, caseVersion: state.body.summary.caseVersion, feeVersion: state.body.summary.version }, directorSession);
      assert.equal(directorForced.status, 200);
      assert.equal((await db.caseItem.findUniqueOrThrow({ where: { id: caseId } })).status, 'CLOSED');
    });

    await test('14. no-success-fee terms still require independent final approval before closure', async () => {
      const noFeeCaseId = 'CASE-SYN-005';
      await db.caseAssignment.createMany({ data: [
        { caseId: noFeeCaseId, userId: 'USR-PM' },
        { caseId: noFeeCaseId, userId: 'USR-DIRECTOR' }
      ] });
      const estimate = await requestJson(origin, `/api/cases/${noFeeCaseId}/fee-compensation/calculate`, 'POST', estimateBody(0, 'NO-FEE', {
        contractAmount: '0', baseAmount: '0', feeRateBps: 0, hasSuccessFee: false
      }), pmSession);
      assert.equal(estimate.status, 201);
      await db.caseItem.update({ where: { id: noFeeCaseId }, data: { status: 'SUCCESS_FEE', version: { increment: 1 } } });
      const beforeFinal = await requestJson(origin, `/api/cases/${noFeeCaseId}/fee-compensation`, 'GET', undefined, pmSession);
      const bypass = await requestJson(origin, `/api/cases/${noFeeCaseId}/close-with-unpaid-check`, 'POST', {
        forceClose: false, caseVersion: beforeFinal.body.summary.caseVersion, feeVersion: beforeFinal.body.summary.version
      }, pmSession);
      assert.equal(bypass.status, 409);
      assert.equal((await db.caseFeeConfig.findUniqueOrThrow({ where: { caseId: noFeeCaseId } })).status, 'DRAFT');
      assert.equal(await db.caseFeeCalculation.count({ where: { caseId: noFeeCaseId, calcType: 'FINAL' } }), 0);

      const finalized = await requestJson(origin, `/api/cases/${noFeeCaseId}/fee-compensation/finalize`, 'POST', {
        calculationId: estimate.body.calculation.id, expectedVersion: 1, idempotencyKey: 'SEC-NO-FEE-FINAL-01'
      }, directorSession);
      assert.equal(finalized.status, 201);
      const closable = await requestJson(origin, `/api/cases/${noFeeCaseId}/fee-compensation`, 'GET', undefined, pmSession);
      const closed = await requestJson(origin, `/api/cases/${noFeeCaseId}/close-with-unpaid-check`, 'POST', {
        forceClose: false, caseVersion: closable.body.summary.caseVersion, feeVersion: closable.body.summary.version
      }, pmSession);
      assert.equal(closed.status, 200);
    });

    await test('15. CLOSED cases reject every fee mutation and generic status cannot bypass fee-governed closure', async () => {
      const closedCaseId = 'CASE-SYN-005';
      const closedState = await requestJson(origin, `/api/cases/${closedCaseId}/fee-compensation`, 'GET', undefined, pmSession);
      assert.equal(closedState.status, 200);
      const closedEstimate = closedState.body.calculations.find((item: { calcType: string }) => item.calcType === 'ESTIMATED');
      const mutationStatuses = await Promise.all([
        requestJson(origin, `/api/cases/${closedCaseId}/fee-compensation/calculate`, 'POST', estimateBody(closedState.body.summary.version, 'AFTER-CLOSE'), pmSession),
        requestJson(origin, `/api/cases/${closedCaseId}/fee-compensation/finalize`, 'POST', {
          calculationId: closedEstimate.id, expectedVersion: closedState.body.summary.version, idempotencyKey: 'SEC-AFTER-CLOSE-FINAL'
        }, directorSession),
        requestJson(origin, `/api/cases/${closedCaseId}/fee-compensation/payments`, 'POST', {
          amount: '1', paymentType: 'ADJUSTMENT', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
          expectedVersion: closedState.body.summary.version, idempotencyKey: 'SEC-AFTER-CLOSE-PAYMENT'
        }, pmSession),
        requestJson(origin, `/api/cases/${closedCaseId}/fee-approvers`, 'POST', {
          userId: 'USR-CEO', expectedCaseVersion: closedState.body.summary.caseVersion
        }, pmSession)
      ]);
      assert.deepEqual(mutationStatuses.map((response) => response.status), [409, 409, 409, 409]);
      assert.equal((await db.caseItem.findUniqueOrThrow({ where: { id: closedCaseId } })).status, 'CLOSED');
      assert.equal(closedState.body.summary.unpaidBalance, '0');
      const closedConfig = await db.caseFeeConfig.findUniqueOrThrow({ where: { caseId } });
      await assert.rejects(
        db.$executeRawUnsafe(`
          INSERT INTO "CaseFeePayment" (
            "id", "organizationId", "caseId", "feeConfigId", "paymentType", "amount",
            "paymentDate", "invoiceStatus", "invoiceIssuedAt", "invoiceNumber", "note",
            "actorId", "idempotencyKey", "idempotencyFingerprint", "createdAt"
          ) VALUES (
            'PAY-P13-RAW-AFTER-CLOSE', 'ORG-SYN-A', ?, ?, 'PARTIAL', 1,
            CURRENT_TIMESTAMP, 'NOT_ISSUED', NULL, NULL, 'synthetic forbidden post-close write',
            'USR-PM', 'RAW-AFTER-CLOSE', 'RAW-AFTER-CLOSE', CURRENT_TIMESTAMP
          )
        `, caseId, closedConfig.id),
        /closed cases reject fee payments/i
      );
      assert.equal(await db.caseFeePayment.count({ where: { id: 'PAY-P13-RAW-AFTER-CLOSE' } }), 0);

      const bypassCase = await requestJson(origin, '/api/cases', 'POST', {
        title: 'SYNTHETIC_P13_GENERIC_CLOSE_BYPASS', claimType: 'TYPE-01', description: 'synthetic only',
        category: { major: 'Synthetic', middle: 'P13', minor: 'Generic close guard' }
      }, pmSession);
      assert.equal(bypassCase.status, 201);
      const bypassCaseId = bypassCase.body.case.id as string;
      const staged = await db.caseItem.update({ where: { id: bypassCaseId }, data: { status: 'SUCCESS_FEE', version: { increment: 1 } } });
      const bypass = await requestJson(origin, `/api/cases/${bypassCaseId}/status`, 'POST', { toStatus: 'CLOSED', version: staged.version }, pmSession);
      assert.equal(bypass.status, 409);
      assert.equal((await db.caseItem.findUniqueOrThrow({ where: { id: bypassCaseId } })).status, 'SUCCESS_FEE');
      assert.equal(await db.caseFeeConfig.count({ where: { caseId: bypassCaseId } }), 0);
    });

    await test('16. concurrent close and payment serialize on the fee version without producing a closed unpaid case', async () => {
      const created = await requestJson(origin, '/api/cases', 'POST', {
        title: 'SYNTHETIC_P13_CLOSE_PAYMENT_RACE', claimType: 'TYPE-01', description: 'synthetic only',
        category: { major: 'Synthetic', middle: 'P13', minor: 'Closure race' }
      }, pmSession);
      assert.equal(created.status, 201);
      const raceCaseId = created.body.case.id as string;
      const assignment = await requestJson(origin, `/api/cases/${raceCaseId}/fee-approvers`, 'POST', {
        userId: 'USR-DIRECTOR', expectedCaseVersion: created.body.case.version
      }, pmSession);
      assert.equal(assignment.status, 201);
      const estimate = await requestJson(origin, `/api/cases/${raceCaseId}/fee-compensation/calculate`, 'POST', estimateBody(0, 'CLOSE-RACE', {
        contractAmount: '1000', baseAmount: '1000', feeRateBps: 10000
      }), pmSession);
      assert.equal(estimate.status, 201);
      const final = await requestJson(origin, `/api/cases/${raceCaseId}/fee-compensation/finalize`, 'POST', {
        calculationId: estimate.body.calculation.id, expectedVersion: 1, idempotencyKey: 'SEC-CLOSE-RACE-FINAL'
      }, directorSession);
      assert.equal(final.status, 201);
      const full = await requestJson(origin, `/api/cases/${raceCaseId}/fee-compensation/payments`, 'POST', {
        amount: final.body.calculation.totalClaimFee, paymentType: 'FULL', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
        expectedVersion: 2, idempotencyKey: 'SEC-CLOSE-RACE-FULL'
      }, pmSession);
      assert.equal(full.status, 201);
      await db.caseItem.update({ where: { id: raceCaseId }, data: { status: 'SUCCESS_FEE', version: { increment: 1 } } });
      const beforeRace = await requestJson(origin, `/api/cases/${raceCaseId}/fee-compensation`, 'GET', undefined, pmSession);
      const raced = await Promise.all([
        requestJson(origin, `/api/cases/${raceCaseId}/close-with-unpaid-check`, 'POST', {
          forceClose: false, caseVersion: beforeRace.body.summary.caseVersion, feeVersion: beforeRace.body.summary.version
        }, pmSession),
        requestJson(origin, `/api/cases/${raceCaseId}/fee-compensation/payments`, 'POST', {
          amount: '1', paymentType: 'ADJUSTMENT', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
          expectedVersion: beforeRace.body.summary.version, idempotencyKey: 'SEC-CLOSE-RACE-ADJUST'
        }, pmSession)
      ]);
      assert.equal(raced.filter((response) => response.status >= 200 && response.status < 300).length, 1);
      assert.equal(raced.some((response) => response.status === 409), true);
      const afterRace = await requestJson(origin, `/api/cases/${raceCaseId}/fee-compensation`, 'GET', undefined, pmSession);
      if (afterRace.body.summary.caseStatus === 'CLOSED') assert.equal(afterRace.body.summary.unpaidBalance, '0');
      else assert.equal(afterRace.body.summary.caseStatus, 'SUCCESS_FEE');
    });
  } finally {
    await closeP13Isolated(context);
  }
});

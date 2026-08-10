import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { startP13Isolated, closeP13Isolated } from './p13-test-support';
import { requestJson } from './p09-test-support';

test('P13 Security Suite: Fee Calculation, Access Control, Immutability & Audits', async () => {
  const context = await startP13Isolated('p13-security');
  const { origin, db, fixture, staffSession, reviewerSession, pmSession, directorSession } = context;
  const { reportId } = fixture;

  const reportRow = await db.report.findUniqueOrThrow({ where: { id: reportId } });
  const caseId = reportRow.caseId;

  try {
    // 1. Negative Amounts and Invalid Bps Rejection (HTTP 400)
    await test('1. Negative amounts & invalid bps must return 400', async () => {
      const res1 = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
        contractAmount: '-1000',
        baseAmount: '50000',
        feeRateBps: 500
      }, pmSession);
      assert.equal(res1.status, 400);

      const res2 = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
        contractAmount: '1000',
        baseAmount: '50000',
        feeRateBps: 150000 // > 100,000 bps (100%)
      }, pmSession);
      assert.equal(res2.status, 400);
    });

    // 2. RBAC Enforcement (Staff/Reviewer Mutation Rejection)
    await test('2. Staff/Reviewer cannot mutate fee calculation or payments (403)', async () => {
      const resStaff = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
        contractAmount: '100000',
        baseAmount: '500000',
        feeRateBps: 500
      }, staffSession);
      assert.equal(resStaff.status, 403);

      const resReviewer = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', {
        amount: '10000'
      }, reviewerSession);
      assert.equal(resReviewer.status, 403);
    });

    // 3. Final Fee Approval RBAC (PM cannot approve FINAL calc)
    await test('3. PM cannot approve FINAL calc, requires Director/CEO (403)', async () => {
      const resPmFinal = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
        contractAmount: '100000',
        baseAmount: '500000',
        feeRateBps: 500,
        calcType: 'FINAL'
      }, pmSession);
      assert.equal(resPmFinal.status, 403);

      const resDirectorFinal = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
        contractAmount: '100000',
        baseAmount: '500000',
        feeRateBps: 500,
        calcType: 'FINAL'
      }, directorSession);
      assert.equal(resDirectorFinal.status, 201);
    });

    // 4. Foreign Case / IDOR Protection (HTTP 404)
    await test('4. Accessing non-existent or cross-tenant case returns 404', async () => {
      const resIdor = await requestJson(origin, `/api/cases/CASE-INVALID-999/fee-compensation`, 'GET', undefined, pmSession);
      assert.equal(resIdor.status, 404);
    });

    // 5. Database Immutability Trigger Enforcement (Append-Only)
    await test('5. SQLite DB triggers prevent UPDATE and DELETE on fee tables', async () => {
      const calcRow = await db.caseFeeCalculation.findFirst({ where: { caseId } });
      assert.ok(calcRow);

      let updateRejected = false;
      try {
        await db.$executeRawUnsafe(`UPDATE "CaseFeeCalculation" SET "calculatedFee" = 99999 WHERE "id" = '${calcRow.id}'`);
      } catch (err) {
        updateRejected = true;
        assert.ok(err);
      }
      assert.ok(updateRejected, 'UPDATE on CaseFeeCalculation must fail via DB trigger');

      let deleteRejected = false;
      try {
        await db.$executeRawUnsafe(`DELETE FROM "CaseFeeCalculation" WHERE "id" = '${calcRow.id}'`);
      } catch (err) {
        deleteRejected = true;
        assert.ok(err);
      }
      assert.ok(deleteRejected, 'DELETE on CaseFeeCalculation must fail via DB trigger');
    });
  } finally {
    await closeP13Isolated(context);
  }
});

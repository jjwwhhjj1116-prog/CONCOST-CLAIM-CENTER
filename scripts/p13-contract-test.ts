import * as assert from 'node:assert/strict';
import { startP13Isolated, closeP13Isolated } from './p13-test-support';
import { requestJson } from './p09-test-support';
import { koreaDateInputValue } from '../apps/web/src/fees/FeeSuccessCompensation';

async function main() {
  console.log('--- Running P13 corrected Fee & Success Compensation Contract Test ---');
  assert.equal(koreaDateInputValue(new Date('2026-08-09T14:59:59.999Z')), '2026-08-09');
  assert.equal(koreaDateInputValue(new Date('2026-08-09T15:00:00.000Z')), '2026-08-10');
  assert.equal(koreaDateInputValue(new Date('2026-08-10T14:59:59.999Z')), '2026-08-10');
  assert.equal(koreaDateInputValue(new Date('2026-08-10T15:00:00.000Z')), '2026-08-11');
  const context = await startP13Isolated('p13-contract');
  try {
    const { origin, db, fixture, pmSession, directorSession } = context;
    const report = await db.report.findUniqueOrThrow({ where: { id: fixture.reportId } });
    const caseId = report.caseId;

    const initial = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.summary.version, 0);

    const exclusiveHalfUpBoundary = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
      contractAmount: '15', baseAmount: '15', feeRateBps: 10000,
      hasSuccessFee: true, billingDate: '2026-08-10', isTaxInclusive: false, calcType: 'ESTIMATED',
      expectedVersion: 0, idempotencyKey: 'IDEM-CALC-VAT-HALF-UP-001'
    }, pmSession);
    assert.equal(exclusiveHalfUpBoundary.status, 201);
    assert.equal(exclusiveHalfUpBoundary.body.calculation.calculatedFee, '15');
    assert.equal(exclusiveHalfUpBoundary.body.calculation.taxAmount, '2');
    assert.equal(exclusiveHalfUpBoundary.body.calculation.totalClaimFee, '17');

    const estimatePayload = {
      contractAmount: '100000000', baseAmount: '500000000', feeRateBps: 500,
      hasSuccessFee: true, billingDate: '2026-08-10', isTaxInclusive: false, calcType: 'ESTIMATED',
      expectedVersion: 1, idempotencyKey: 'IDEM-CALC-EST-001'
    };
    const estimate = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimatePayload, pmSession);
    assert.equal(estimate.status, 201);
    assert.equal(estimate.body.calculation.calculatedFee, '25000000');
    assert.equal(estimate.body.calculation.taxAmount, '2500000');
    assert.equal(estimate.body.calculation.totalClaimFee, '27500000');

    const replay = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', estimatePayload, pmSession);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.idempotentReplay, true);
    const mismatch = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', { ...estimatePayload, baseAmount: '500000001' }, pmSession);
    assert.equal(mismatch.status, 409);

    const afterEstimate = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, directorSession);
    const finalized = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/finalize`, 'POST', {
      calculationId: estimate.body.calculation.id, expectedVersion: afterEstimate.body.summary.version,
      idempotencyKey: 'IDEM-CALC-FINAL-001'
    }, directorSession);
    assert.equal(finalized.status, 201);
    assert.equal(finalized.body.calculation.calcType, 'FINAL');
    assert.equal(finalized.body.calculation.sourceCalculationId, estimate.body.calculation.id);

    const beforePayment = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    const payment = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', {
      amount: '10000000', paymentType: 'PARTIAL', paymentDate: '2026-08-10',
      invoiceStatus: 'ISSUED', invoiceIssuedAt: '2026-08-10', invoiceNumber: 'SYNTHETIC-INV-001',
      note: 'Synthetic partial receipt', expectedVersion: beforePayment.body.summary.version,
      idempotencyKey: 'IDEM-PAY-001'
    }, pmSession);
    assert.equal(payment.status, 201);

    const afterPayment = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    assert.equal(afterPayment.body.summary.totalPaid, '10000000');
    assert.equal(afterPayment.body.summary.unpaidBalance, '17500000');

    const adjustment = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', {
      amount: '1', paymentType: 'ADJUSTMENT', paymentDate: '2026-08-10', invoiceStatus: 'NOT_ISSUED',
      note: 'Synthetic one-won reversal', expectedVersion: afterPayment.body.summary.version,
      idempotencyKey: 'IDEM-ADJUST-001'
    }, pmSession);
    assert.equal(adjustment.status, 201);
    const afterAdjustment = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    assert.equal(afterAdjustment.body.summary.totalPaid, '9999999');
    assert.equal(afterAdjustment.body.summary.unpaidBalance, '17500001');

    await db.caseItem.update({ where: { id: caseId }, data: { status: 'SUCCESS_FEE', version: { increment: 1 } } });
    const closable = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    const warning = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', {
      forceClose: false, caseVersion: closable.body.summary.caseVersion, feeVersion: closable.body.summary.version
    }, pmSession);
    assert.equal(warning.status, 409);
    assert.equal(warning.body.requiresConfirmation, true);
    const pmForce = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', {
      forceClose: true, caseVersion: closable.body.summary.caseVersion, feeVersion: closable.body.summary.version
    }, pmSession);
    assert.equal(pmForce.status, 403);
    const directorForce = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', {
      forceClose: true, caseVersion: closable.body.summary.caseVersion, feeVersion: closable.body.summary.version
    }, directorSession);
    assert.equal(directorForce.status, 200);
    assert.equal(directorForce.body.case.status, 'CLOSED');
    assert.ok(await db.statusHistory.findFirst({ where: { caseId, fromStatus: 'SUCCESS_FEE', toStatus: 'CLOSED' } }));

    const zeroCaseId = 'CASE-SYN-004';
    const zero = await requestJson(origin, `/api/cases/${zeroCaseId}/fee-compensation/calculate`, 'POST', {
      contractAmount: '0', baseAmount: '1', feeRateBps: 999999, hasSuccessFee: false,
      billingDate: '2026-08-10', isTaxInclusive: false, expectedVersion: 0, idempotencyKey: 'IDEM-ZERO-FEE-001'
    }, pmSession);
    assert.equal(zero.status, 201);
    assert.equal(zero.body.calculation.totalClaimFee, '0');

    const zeroFinal = await requestJson(origin, `/api/cases/${zeroCaseId}/fee-compensation/finalize`, 'POST', {
      calculationId: zero.body.calculation.id, expectedVersion: 1, idempotencyKey: 'IDEM-ZERO-FINAL-001'
    }, directorSession);
    assert.equal(zeroFinal.status, 201);
    assert.equal(zeroFinal.body.calculation.hasSuccessFee, false);

    console.log('✅ P13 corrected contract test passed');
  } finally {
    await closeP13Isolated(context);
  }
}

main().catch((error) => { console.error('❌ P13 contract test failed:', error); process.exit(1); });

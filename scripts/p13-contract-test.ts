import * as assert from 'node:assert/strict';
import { startP13Isolated, closeP13Isolated } from './p13-test-support';
import { requestJson } from './p09-test-support';

async function main() {
  console.log('--- Running P13 Fee & Success Compensation Contract Test ---');
  const context = await startP13Isolated('p13-contract');

  try {
    const { origin, db, fixture, pmSession, directorSession } = context;
    const { reportId } = fixture;

    const reportRow = await db.report.findUniqueOrThrow({ where: { id: reportId } });
    const caseId = reportRow.caseId;

    // 1. Initial Fee Compensation GET
    console.log('1. Testing GET /api/cases/:caseId/fee-compensation...');
    const getRes1 = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    assert.equal(getRes1.status, 200);
    assert.equal(getRes1.body.summary.unpaidBalance, '0');

    // 2. Estimated Calculation (500 bps = 5.00% on 500,000,000 KRW = 25,000,000 + 10% tax = 27,500,000 total)
    console.log('2. Testing ESTIMATED Fee Calculation & half-up integer math...');
    const estRes = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
      contractAmount: '100000000',
      baseAmount: '500000000',
      feeRateBps: 500,
      hasSuccessFee: true,
      isTaxInclusive: false,
      calcType: 'ESTIMATED',
      idempotencyKey: 'IDEM-CALC-EST-001'
    }, pmSession);
    assert.equal(estRes.status, 201);
    assert.equal(estRes.body.calculation.calculatedFee, '25000000');
    assert.equal(estRes.body.calculation.taxAmount, '2500000');
    assert.equal(estRes.body.calculation.totalClaimFee, '27500000');

    // Test Idempotent replay
    const estReplay = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
      contractAmount: '100000000',
      baseAmount: '500000000',
      feeRateBps: 500,
      hasSuccessFee: true,
      isTaxInclusive: false,
      calcType: 'ESTIMATED',
      idempotencyKey: 'IDEM-CALC-EST-001'
    }, pmSession);
    assert.equal(estReplay.status, 200);
    assert.equal(estReplay.body.idempotentReplay, true);

    // 3. FINAL Calculation (Director approval)
    console.log('3. Testing FINAL Fee Calculation & Status Fixation...');
    const finalRes = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/calculate`, 'POST', {
      contractAmount: '100000000',
      baseAmount: '500000000',
      feeRateBps: 500,
      hasSuccessFee: true,
      isTaxInclusive: false,
      calcType: 'FINAL',
      idempotencyKey: 'IDEM-CALC-FINAL-001'
    }, directorSession);
    assert.equal(finalRes.status, 201);
    assert.equal(finalRes.body.calculation.calcType, 'FINAL');

    // 4. Payment Recording & Unpaid Balance Calculation
    console.log('4. Testing Payment Recording & Unpaid Balance...');
    const payRes1 = await requestJson(origin, `/api/cases/${caseId}/fee-compensation/payments`, 'POST', {
      amount: '10000000',
      paymentType: 'PARTIAL',
      invoiceStatus: 'ISSUED',
      invoiceNumber: 'INV-2026-TEST',
      note: '1차 부분 입금',
      idempotencyKey: 'IDEM-PAY-001'
    }, pmSession);
    assert.equal(payRes1.status, 201);

    const getRes2 = await requestJson(origin, `/api/cases/${caseId}/fee-compensation`, 'GET', undefined, pmSession);
    assert.equal(getRes2.status, 200);
    assert.equal(getRes2.body.summary.totalPaid, '10000000');
    assert.equal(getRes2.body.summary.unpaidBalance, '17500000'); // 27,500,000 - 10,000,000 = 17,500,000

    // 5. Unpaid Case Closure Guard & Force Close Policy
    console.log('5. Testing Unpaid Case Closure Guard & Force Close Policy...');
    const closeAttempt1 = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', {
      forceClose: false
    }, pmSession);
    assert.equal(closeAttempt1.status, 409, 'Unpaid balance must trigger 409 conflict on normal close attempt');
    assert.equal(closeAttempt1.body.unpaidBalance, '17500000');

    // Force close
    const closeAttempt2 = await requestJson(origin, `/api/cases/${caseId}/close-with-unpaid-check`, 'POST', {
      forceClose: true
    }, pmSession);
    assert.equal(closeAttempt2.status, 200);
    assert.equal(closeAttempt2.body.case.status, 'CLOSED');

    console.log('✅ P13 Fee & Success Compensation Contract Test Passed Cleanly!');
  } finally {
    await closeP13Isolated(context);
  }
}

main().catch((err) => {
  console.error('❌ P13 Contract Test Failed:', err);
  process.exit(1);
});

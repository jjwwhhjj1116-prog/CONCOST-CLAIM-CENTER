import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { startP16Isolated, requestJson } from './p16-test-support';

describe('P16 Production Configuration & Fail-Closed Security Suite', async () => {
  const context = await startP16Isolated('p16-prod-cfg', {
    allowTestAiModes: false,
    allowTestGoogleModes: false
  });

  test('1. Production Mode Rejects Unconfigured Test/Fake Providers (503 Guard)', async () => {
    const { origin, caseId, fixture } = context;
    const pmSession = fixture.pm;

    // Fake AI or unconfigured Google endpoints must return 503
    const driveRes = await requestJson(origin, `/api/cases/${caseId}/google/drive-folder`, 'POST', {}, pmSession);
    assert.equal(driveRes.status, 503);
    assert.match(driveRes.body.error, /not configured/i);
  });

  test('2. Log & Response Zero-Secret Leakage Contract', async () => {
    const { origin } = context;

    const healthRes = await requestJson(origin, '/api/health', 'GET');
    assert.equal(healthRes.status, 200);

    const jsonText = JSON.stringify(healthRes.body);
    assert.equal(jsonText.includes('passwordHash'), false);
    assert.equal(jsonText.includes('tokenHash'), false);
    assert.equal(jsonText.includes('session_token'), false);
  });

  test.after(async () => {
    await context.cleanup();
  });
});

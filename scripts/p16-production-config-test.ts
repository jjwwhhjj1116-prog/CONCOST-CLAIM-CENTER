import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { databaseUrlFor, resetDatabase, seedDatabase } from '@claim-studio/database';
import {
  createApiServer, createApiServerFromEnvironment, type ManagedApiServer
} from '../apps/api/src/server';

const root = path.resolve(__dirname, '..');
const key = (label: string) => crypto.createHash('sha256').update(label).digest('hex');

async function listen(server: ManagedApiServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function close(server: ManagedApiServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await server.waitForDatabaseClose();
}

describe('P16 production bootstrap and fail-closed configuration', () => {
  test('1. production refuses missing root, missing keys, and test provider modes', () => {
    assert.throws(() => createApiServerFromEnvironment({ NODE_ENV: 'production' }), /CLAIM_VOLUME_ROOT/);
    const volumeRootDir = path.join(root, 'packages/database/.data/p16-missing-key');
    assert.throws(() => createApiServerFromEnvironment({
      NODE_ENV: 'production',
      CLAIM_VOLUME_ROOT: volumeRootDir,
      CLAIM_ALLOWED_ORIGINS: 'https://staging.claim-center.invalid'
    }), /CLAIM_BACKUP_SIGNING_KEY_REF/);
    assert.throws(() => createApiServer({
      environment: { NODE_ENV: 'production' },
      allowTestGoogleModes: true
    }), /forbidden in production/);
    fs.rmSync(volumeRootDir, { recursive: true, force: true });
  });

  test('2. an explicit production volume boots with secure, secret-free probes and fake routes disabled', async () => {
    const dataRoot = path.join(root, 'packages/database/.data', `p16-production-${process.pid}-${Date.now()}`);
    const databasePath = path.join(dataRoot, 'database', 'claim-center.db');
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      CLAIM_VOLUME_ROOT: dataRoot,
      CLAIM_ALLOWED_ORIGINS: 'https://staging.claim-center.invalid',
      CLAIM_BACKUP_SIGNING_KEY_REF: 'ENV_P16_BACKUP_KEY',
      P16_BACKUP_KEY: key('p16 production backup'),
      GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF: 'ENV_P16_CREDENTIAL_KEY',
      P16_CREDENTIAL_KEY: key('p16 production credentials')
    };
    await resetDatabase(databaseUrlFor(databasePath));
    await seedDatabase(databaseUrlFor(databasePath));
    const server = createApiServerFromEnvironment(environment);
    try {
      const origin = await listen(server);
      const health = await fetch(origin + '/api/health');
      const readiness = await fetch(origin + '/api/readiness');
      assert.equal(health.status, 200);
      assert.equal(readiness.status, 200);
      const probeText = JSON.stringify([await health.json(), await readiness.json()]);
      assert.doesNotMatch(probeText, /P16_BACKUP_KEY|P16_CREDENTIAL_KEY|CLAIM_VOLUME_ROOT|secret|token/i);
      const fake = await fetch(origin + '/api/google-workspace/fake-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'SUCCESS' })
      });
      assert.notEqual(fake.status, 200);
    } finally {
      if (server.listening) await close(server);
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('3. unexpected exceptions are logged and returned without raw credentials', async () => {
    const marker = 'access_token=P16_SYNTHETIC_SECRET_MARKER';
    const dataRoot = path.join(root, 'packages/database/.data', `p16-redaction-${process.pid}-${Date.now()}`);
    const databasePath = path.join(dataRoot, 'database', 'claim-center.db');
    const uploadDir = path.join(dataRoot, 'storage');
    const backupRootDir = path.join(dataRoot, 'backups');
    const restoreRootDir = path.join(dataRoot, 'restores');
    const credentialVaultDir = path.join(dataRoot, 'google-credentials');
    const pkceVaultDir = path.join(dataRoot, 'google-pkce');
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, 'placeholder');
    const fakeDb = {
      user: { findUnique: async () => { throw new Error(marker); } },
      $disconnect: async () => undefined
    } as any;
    const server = createApiServer({
      db: fakeDb,
      environment: {
        NODE_ENV: 'production',
        GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY_REF: 'ENV_P16_CREDENTIAL_KEY',
        P16_CREDENTIAL_KEY: key('p16 redaction credentials')
      },
      volumeRootDir: dataRoot,
      databasePath,
      uploadDir,
      backupRootDir,
      restoreRootDir,
      credentialVaultDir,
      pkceVaultDir,
      backupSigningKey: Buffer.from(key('p16 redaction backup'), 'hex'),
      allowedOrigins: ['https://staging.claim-center.invalid'],
      secureCookies: true
    });
    const captured: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { captured.push(args); };
    try {
      const origin = await listen(server);
      const response = await fetch(origin + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.invalid', password: marker })
      });
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.doesNotMatch(body, /P16_SYNTHETIC_SECRET_MARKER|access_token/i);
      assert.doesNotMatch(JSON.stringify(captured), /P16_SYNTHETIC_SECRET_MARKER|access_token/i);
    } finally {
      console.error = originalError;
      if (server.listening) await close(server);
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

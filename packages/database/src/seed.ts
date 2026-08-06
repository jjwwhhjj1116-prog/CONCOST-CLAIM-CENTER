import * as crypto from 'node:crypto';
import { createPrismaClient, getDatabaseUrl } from './db-engine';

const SCRYPT_KEY_LENGTH = 32;

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): string {
  const digest = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, expectedHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function seedPasswordHash(userId: string): string {
  const deterministicSalt = crypto.createHash('sha256').update(`P04_SYNTHETIC_${userId}`).digest('hex').slice(0, 32);
  return hashPassword('Password123!', deterministicSalt);
}

export async function seedDatabase(databaseUrl = getDatabaseUrl()): Promise<void> {
  const db = createPrismaClient(databaseUrl);
  const now = new Date('2026-01-01T00:00:00.000Z');
  const future = new Date('2099-01-01T00:00:00.000Z');
  const past = new Date('2025-01-01T00:00:00.000Z');

  try {
    await db.$transaction(async (tx) => {
      for (const id of ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin']) {
        await tx.role.upsert({ where: { id }, update: { name: id.toUpperCase() }, create: { id, name: id.toUpperCase() } });
      }

      for (const organization of [
        { id: 'ORG-SYN-A', name: 'Synthetic Organization Alpha' },
        { id: 'ORG-SYN-B', name: 'Synthetic Organization Beta' }
      ]) {
        await tx.organization.upsert({
          where: { id: organization.id },
          update: { name: organization.name, updatedAt: now },
          create: { ...organization, createdAt: now, updatedAt: now }
        });
      }

      const users = [
        ['USR-ADMIN', 'admin@example.invalid', 'admin', 'ORG-SYN-A', 'Synthetic Admin'],
        ['USR-CEO', 'ceo@example.invalid', 'ceo', 'ORG-SYN-A', 'Synthetic CEO'],
        ['USR-DIRECTOR', 'director@example.invalid', 'director', 'ORG-SYN-A', 'Synthetic Director'],
        ['USR-PM', 'pm@example.invalid', 'pm', 'ORG-SYN-A', 'Synthetic PM'],
        ['USR-STAFF', 'staff@example.invalid', 'staff', 'ORG-SYN-A', 'Synthetic Staff'],
        ['USR-REVIEWER', 'reviewer@example.invalid', 'reviewer', 'ORG-SYN-A', 'Synthetic Reviewer'],
        ['USR-ORGB-PM', 'pm_b@example.invalid', 'pm', 'ORG-SYN-B', 'Synthetic Organization B PM']
      ] as const;

      for (const [id, email, roleId, organizationId, name] of users) {
        await tx.user.upsert({
          where: { id },
          update: { email, passwordHash: seedPasswordHash(id), name, organizationId, isActive: true, updatedAt: now },
          create: { id, email, passwordHash: seedPasswordHash(id), name, organizationId, isActive: true, createdAt: now, updatedAt: now }
        });
        await tx.userRole.upsert({ where: { userId_roleId: { userId: id, roleId } }, update: {}, create: { userId: id, roleId } });
      }

      const sessions = [
        ['SESS-PM-VALID', 'USR-PM', 'TOKEN_SYNTHETIC_PM_VALID', future, null],
        ['SESS-PM-REVOKED', 'USR-PM', 'TOKEN_SYNTHETIC_PM_REVOKED', future, past],
        ['SESS-REVIEWER-VALID', 'USR-REVIEWER', 'TOKEN_SYNTHETIC_REVIEWER_VALID', future, null]
      ] as const;
      for (const [id, userId, rawToken, expiresAt, revokedAt] of sessions) {
        await tx.session.upsert({
          where: { id },
          update: { userId, tokenHash: hashToken(rawToken), expiresAt, revokedAt },
          create: { id, userId, tokenHash: hashToken(rawToken), expiresAt, revokedAt, createdAt: now }
        });
      }

      const cases = [
        ['CASE-SYN-001', 'ORG-SYN-A', 'SYNTHETIC_CASE_01', 'TYPE-01', null],
        ['CASE-SYN-002', 'ORG-SYN-A', 'SYNTHETIC_CASE_02_DELETED', 'TYPE-02', now],
        ['CASE-SYN-003', 'ORG-SYN-A', 'SYNTHETIC_CASE_03_UNASSIGNED_PM', 'TYPE-03', null],
        ['CASE-SYN-ORGB', 'ORG-SYN-B', 'SYNTHETIC_CASE_ORGB', 'TYPE-03', null]
      ] as const;
      for (const [id, organizationId, title, claimType, deletedAt] of cases) {
        await tx.caseItem.upsert({
          where: { id },
          update: { organizationId, title, claimType, version: 1, deletedAt, updatedAt: now },
          create: { id, organizationId, title, claimType, version: 1, deletedAt, createdAt: now, updatedAt: now }
        });
      }

      for (const [caseId, userId] of [
        ['CASE-SYN-001', 'USR-PM'],
        ['CASE-SYN-001', 'USR-STAFF'],
        ['CASE-SYN-001', 'USR-REVIEWER'],
        ['CASE-SYN-003', 'USR-STAFF'],
        ['CASE-SYN-ORGB', 'USR-ORGB-PM']
      ]) {
        await tx.caseAssignment.upsert({ where: { caseId_userId: { caseId, userId } }, update: {}, create: { caseId, userId } });
      }

      await tx.report.upsert({
        where: { id: 'REPO-SYN-001' },
        update: { caseId: 'CASE-SYN-001', title: 'SYNTHETIC_REPORT_01', version: 1, deletedAt: null, updatedAt: now },
        create: { id: 'REPO-SYN-001', caseId: 'CASE-SYN-001', title: 'SYNTHETIC_REPORT_01', version: 1, createdAt: now, updatedAt: now }
      });
      await tx.reportSection.upsert({
        where: { id: 'SEC-SYN-001' },
        update: { reportId: 'REPO-SYN-001', title: 'Facts', content: 'Synthetic facts only.', status: 'draft', version: 1, deletedAt: null, updatedAt: now },
        create: { id: 'SEC-SYN-001', reportId: 'REPO-SYN-001', title: 'Facts', content: 'Synthetic facts only.', status: 'draft', version: 1, createdAt: now, updatedAt: now }
      });

      await tx.auditLog.upsert({
        where: { id: 'AUD-SYN-001' },
        update: {},
        create: {
          id: 'AUD-SYN-001', organizationId: 'ORG-SYN-A', userId: 'USR-ADMIN', action: 'SEED_INITIALIZED',
          targetEntity: 'System', targetId: 'P04', metadataJson: JSON.stringify({ source: 'synthetic-seed' }), createdAt: now
        }
      });
    });
  } finally {
    await db.$disconnect();
  }
  console.log('Database seeded with deterministic synthetic P04 fixtures.');
}

if (require.main === module) {
  void seedDatabase().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

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
      // 1. Roles
      for (const id of ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin']) {
        await tx.role.upsert({ where: { id }, update: { name: id.toUpperCase() }, create: { id, name: id.toUpperCase() } });
      }

      // 2. Organizations
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

      // 3. Users
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

      // 4. Sessions
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

      // 5. P05 Cases (Fixed 6 types TYPE-01 to TYPE-06, long name, same name, soft deleted, Org B)
      const cases = [
        { id: 'CASE-SYN-001', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0001', title: 'SYNTHETIC_CASE_01', description: 'Sample case 1 description', claimType: 'TYPE-01', status: 'INQUIRY', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-002', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0002', title: 'SYNTHETIC_CASE_02_DELETED', description: 'Deleted case', claimType: 'TYPE-02', status: 'PROPOSAL', assignedUserId: 'USR-STAFF', deletedAt: now },
        { id: 'CASE-SYN-003', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0003', title: 'SYNTHETIC_CASE_03_UNASSIGNED_PM', description: 'Sample case 3', claimType: 'TYPE-03', status: 'ANALYSIS', assignedUserId: 'USR-STAFF', deletedAt: null },
        { id: 'CASE-SYN-004', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0004', title: 'SYNTHETIC_CASE_04_TYPE4', description: 'Type 4 case', claimType: 'TYPE-04', status: 'SUBMITTED', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-005', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0005', title: 'SYNTHETIC_CASE_05_TYPE5', description: 'Type 5 case', claimType: 'TYPE-05', status: 'JUDGEMENT', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-006', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0006', title: 'SYNTHETIC_CASE_06_TYPE6', description: 'Type 6 case', claimType: 'TYPE-06', status: 'CLOSED', assignedUserId: 'USR-PM', deletedAt: null },
        // Same Name Cases (Different ID and caseNumber)
        { id: 'CASE-SYN-SAME-1', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0007', title: 'SYNTHETIC_DUPLICATE_CASE_TITLE', description: 'Synthetic duplicate case one', claimType: 'TYPE-01', status: 'CONTRACT', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-SAME-2', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0008', title: 'SYNTHETIC_DUPLICATE_CASE_TITLE', description: 'Synthetic duplicate case two', claimType: 'TYPE-02', status: 'MATERIAL_RECEIVED', assignedUserId: 'USR-PM', deletedAt: null },
        // Very Long Case Title Case (100+ chars)
        { id: 'CASE-SYN-LONG', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0009', title: 'A'.repeat(120), description: 'Synthetic long-title boundary fixture', claimType: 'TYPE-01', status: 'REPORT_DRAFTING', assignedUserId: 'USR-PM', deletedAt: null },
        // Stress Case (for 10 parties & 100 schedules testing)
        { id: 'CASE-SYN-STRESS', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0010', title: 'SYNTHETIC_STRESS_CASE', description: 'Synthetic fixture with 10 parties and 100 schedules', claimType: 'TYPE-01', status: 'LITIGATION', assignedUserId: 'USR-PM', deletedAt: null },
        // Org B Case (for IDOR)
        { id: 'CASE-SYN-ORGB', organizationId: 'ORG-SYN-B', caseNumber: 'CASE-ORGB-0001', title: 'SYNTHETIC_CASE_ORGB', description: 'Org B private case', claimType: 'TYPE-03', status: 'ANALYSIS', assignedUserId: 'USR-ORGB-PM', deletedAt: null }
      ];

      for (const c of cases) {
        await tx.caseItem.upsert({
          where: { id: c.id },
          update: { ...c, version: 1, updatedAt: now },
          create: { ...c, version: 1, createdAt: now, updatedAt: now }
        });
      }

      // 6. Exact major/middle/minor classification for every synthetic case.
      for (const c of cases) {
        await tx.caseCategory.upsert({
          where: { caseId: c.id },
          update: { major: 'SYNTHETIC_MAJOR', middle: `SYNTHETIC_${c.claimType}`, minor: 'SYNTHETIC_MINOR', updatedAt: now },
          create: {
            id: `CAT-${c.id}`, caseId: c.id, major: 'SYNTHETIC_MAJOR',
            middle: `SYNTHETIC_${c.claimType}`, minor: 'SYNTHETIC_MINOR', createdAt: now, updatedAt: now
          }
        });
      }

      // 7. Case Assignments
      for (const [caseId, userId] of [
        ['CASE-SYN-001', 'USR-PM'],
        ['CASE-SYN-001', 'USR-STAFF'],
        ['CASE-SYN-001', 'USR-REVIEWER'],
        ['CASE-SYN-003', 'USR-STAFF'],
        ['CASE-SYN-004', 'USR-PM'],
        ['CASE-SYN-SAME-1', 'USR-PM'],
        ['CASE-SYN-SAME-2', 'USR-PM'],
        ['CASE-SYN-LONG', 'USR-PM'],
        ['CASE-SYN-STRESS', 'USR-PM'],
        ['CASE-SYN-ORGB', 'USR-ORGB-PM']
      ]) {
        await tx.caseAssignment.upsert({ where: { caseId_userId: { caseId, userId } }, update: {}, create: { caseId, userId } });
      }

      // 8. Parties (0 for CASE-SYN-001, 1 for CASE-SYN-004, 10 for CASE-SYN-STRESS with duplicate names)
      const parties = [
        { id: 'PARTY-SYN-001', caseId: 'CASE-SYN-004', name: 'SYNTHETIC_PARTY_01', role: 'CLAIMANT', contact: 'party01@example.invalid' }
      ];
      // 10 parties for STRESS case (including duplicate names with distinct IDs)
      for (let i = 1; i <= 10; i++) {
        const duplicateName = i % 2 === 0 ? 'SYNTHETIC_DUPLICATE_PARTY' : `SYNTHETIC_PARTY_${i}`;
        parties.push({
          id: `PARTY-STRESS-${i}`,
          caseId: 'CASE-SYN-STRESS',
          name: duplicateName,
          role: i <= 5 ? 'CLAIMANT' : 'RESPONDENT',
          contact: `party${i}@example.invalid`
        });
      }

      for (const p of parties) {
        await tx.party.upsert({
          where: { id: p.id },
          update: { ...p, updatedAt: now },
          create: { ...p, createdAt: now, updatedAt: now }
        });
      }

      // 9. Schedules (0 for CASE-SYN-001, 1 for CASE-SYN-004, 100 for CASE-SYN-STRESS)
      const schedules = [
        { id: 'SCHED-SYN-001', caseId: 'CASE-SYN-004', title: 'SYNTHETIC_COURT_DEADLINE', type: 'COURT', date: new Date('2026-03-01T10:00:00.000Z'), location: 'SYNTHETIC_COURT_ROOM', description: 'Synthetic court schedule' }
      ];
      // 100 schedules for STRESS case (including COURT, CLIENT, INTERNAL, Leap day 2028-02-29, month boundaries, past dates)
      for (let i = 1; i <= 100; i++) {
        const types = ['COURT', 'CLIENT', 'INTERNAL'];
        const type = types[i % 3];
        let schedDate: Date;
        if (i === 1) {
          // Leap day test
          schedDate = new Date('2028-02-29T14:00:00.000Z');
        } else if (i === 2) {
          // Past date
          schedDate = new Date('2025-12-31T09:00:00.000Z');
        } else {
          schedDate = new Date(Date.UTC(2026, (i % 12), (i % 28) + 1, 10, 0, 0));
        }
        schedules.push({
          id: `SCHED-STRESS-${i}`,
          caseId: 'CASE-SYN-STRESS',
          title: `SYNTHETIC_SCHEDULE_${i}`,
          type,
          date: schedDate,
          location: `SYNTHETIC_ROOM_${i % 5 + 1}`,
          description: `Synthetic schedule boundary fixture ${i}`
        });
      }

      for (const s of schedules) {
        await tx.schedule.upsert({
          where: { id: s.id },
          update: { ...s, updatedAt: now },
          create: { ...s, createdAt: now, updatedAt: now }
        });
      }

      // 10. Status Histories (append-only: seed never updates an existing row).
      const statusHistories = [
        { id: 'STHIST-SYN-001', caseId: 'CASE-SYN-001', fromStatus: null, toStatus: 'INQUIRY', changedById: 'USR-PM', reason: 'Synthetic case initialized' },
        { id: 'STHIST-SYN-002', caseId: 'CASE-SYN-003', fromStatus: null, toStatus: 'ANALYSIS', changedById: 'USR-PM', reason: 'Synthetic fixture initialized at analysis' }
      ];
      for (const sh of statusHistories) {
        const exists = await tx.statusHistory.findUnique({ where: { id: sh.id }, select: { id: true } });
        if (!exists) await tx.statusHistory.create({ data: { ...sh, createdAt: now } });
      }

      // 11. Reports & Report Sections
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

      // 12. Initial Audit Log
      await tx.auditLog.upsert({
        where: { id: 'AUD-SYN-001' },
        update: {},
        create: {
          id: 'AUD-SYN-001', organizationId: 'ORG-SYN-A', userId: 'USR-ADMIN', action: 'SEED_INITIALIZED',
          targetEntity: 'System', targetId: 'P05', metadataJson: JSON.stringify({ source: 'synthetic-seed-p05' }), createdAt: now
        }
      });
    });
  } finally {
    await db.$disconnect();
  }
  console.log('Database seeded with deterministic synthetic P05 fixtures.');
}

if (require.main === module) {
  void seedDatabase().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

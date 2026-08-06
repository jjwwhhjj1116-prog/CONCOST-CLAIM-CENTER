import { getDbConnection, initDatabaseSchema } from './db-engine';
import * as crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = 'synthetic_salt_p04';
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function seedDatabase() {
  initDatabaseSchema();
  const db = getDbConnection();

  const now = new Date().toISOString();

  // 1. Seed Roles (Exactly 6 roles: ceo, director, pm, staff, reviewer, admin)
  const roles = ['ceo', 'director', 'pm', 'staff', 'reviewer', 'admin'];
  const insertRole = db.prepare('INSERT OR REPLACE INTO Role (id, name) VALUES (?, ?)');
  for (const r of roles) {
    insertRole.run(r, r.toUpperCase());
  }

  // 2. Seed Organizations
  const insertOrg = db.prepare('INSERT OR REPLACE INTO Organization (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)');
  insertOrg.run('ORG-SYN-A', 'Synthetic Org Alpha (example.invalid)', now, now);
  insertOrg.run('ORG-SYN-B', 'Synthetic Org Beta (example.invalid)', now, now);

  // 3. Seed Users
  const insertUser = db.prepare('INSERT OR REPLACE INTO User (id, email, passwordHash, name, organizationId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertUserRole = db.prepare('INSERT OR REPLACE INTO UserRole (userId, roleId) VALUES (?, ?)');

  const defaultPasswordHash = hashPassword('Password123!');

  const usersData = [
    { id: 'USR-ADMIN', email: 'admin@example.invalid', role: 'admin', org: 'ORG-SYN-A', name: 'Synth Admin' },
    { id: 'USR-CEO', email: 'ceo@example.invalid', role: 'ceo', org: 'ORG-SYN-A', name: 'Synth CEO' },
    { id: 'USR-DIRECTOR', email: 'director@example.invalid', role: 'director', org: 'ORG-SYN-A', name: 'Synth Director' },
    { id: 'USR-PM', email: 'pm@example.invalid', role: 'pm', org: 'ORG-SYN-A', name: 'Synth PM' },
    { id: 'USR-STAFF', email: 'staff@example.invalid', role: 'staff', org: 'ORG-SYN-A', name: 'Synth Staff' },
    { id: 'USR-REVIEWER', email: 'reviewer@example.invalid', role: 'reviewer', org: 'ORG-SYN-A', name: 'Synth Reviewer' },
    // Org B User (for IDOR tests)
    { id: 'USR-ORGB-PM', email: 'pm_b@example.invalid', role: 'pm', org: 'ORG-SYN-B', name: 'Org B PM' }
  ];

  for (const u of usersData) {
    insertUser.run(u.id, u.email, defaultPasswordHash, u.name, u.org, 1, now, now);
    insertUserRole.run(u.id, u.role);
  }

  // 4. Seed Active & Revoked Sessions
  const insertSession = db.prepare('INSERT OR REPLACE INTO Session (id, userId, tokenHash, expiresAt, revokedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
  
  const tokenPM = 'TOKEN_SYNTHETIC_PM_VALID';
  const tokenRevoked = 'TOKEN_SYNTHETIC_PM_REVOKED';
  const tokenReviewer = 'TOKEN_SYNTHETIC_REVIEWER_VALID';

  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  insertSession.run('SESS-PM-VALID', 'USR-PM', hashToken(tokenPM), future, null, now);
  insertSession.run('SESS-PM-REVOKED', 'USR-PM', hashToken(tokenRevoked), future, past, now);
  insertSession.run('SESS-REVIEWER-VALID', 'USR-REVIEWER', hashToken(tokenReviewer), future, null, now);

  // 5. Seed Cases & CaseAssignments
  const insertCase = db.prepare('INSERT OR REPLACE INTO CaseItem (id, organizationId, title, claimType, version, deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertCaseAssign = db.prepare('INSERT OR REPLACE INTO CaseAssignment (caseId, userId) VALUES (?, ?)');

  insertCase.run('CASE-SYN-001', 'ORG-SYN-A', 'SYNTHETIC_CASE_01', 'TYPE-01', 1, null, now, now);
  insertCase.run('CASE-SYN-002', 'ORG-SYN-A', 'SYNTHETIC_CASE_02_DELETED', 'TYPE-02', 1, now, now, now);
  insertCase.run('CASE-SYN-ORGB', 'ORG-SYN-B', 'SYNTHETIC_CASE_ORGB', 'TYPE-03', 1, null, now, now);

  insertCaseAssign.run('CASE-SYN-001', 'USR-PM');
  insertCaseAssign.run('CASE-SYN-001', 'USR-STAFF');

  // 6. Seed Reports & ReportSections
  const insertReport = db.prepare('INSERT OR REPLACE INTO Report (id, caseId, title, version, deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertSection = db.prepare('INSERT OR REPLACE INTO ReportSection (id, reportId, title, content, status, version, deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

  insertReport.run('REPO-SYN-001', 'CASE-SYN-001', 'SYNTHETIC_REPORT_01', 1, null, now, now);
  insertSection.run('SEC-SYN-001', 'REPO-SYN-001', '1장 사실관계', '합성 사실관계 내용...', 'unwritten', 1, null, now, now);

  // 7. Seed Initial Audit Log
  const insertAudit = db.prepare('INSERT INTO AuditLog (id, organizationId, userId, action, targetEntity, targetId, metadataJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertAudit.run('AUD-SYN-001', 'ORG-SYN-A', 'USR-ADMIN', 'SEED_INITIALIZED', 'System', '0', JSON.stringify({ ip: '127.0.0.1' }), now);

  db.close();
  console.log('✓ Database seeded successfully with synthetic data (ORG-SYN-A, ORG-SYN-B).');
}

if (require.main === module) {
  seedDatabase();
}

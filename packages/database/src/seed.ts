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

      // 5. P05 Cases
      const cases = [
        { id: 'CASE-SYN-001', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0001', title: 'SYNTHETIC_CASE_01', description: 'Sample case 1 description', claimType: 'TYPE-01', status: 'INQUIRY', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-002', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0002', title: 'SYNTHETIC_CASE_02_DELETED', description: 'Deleted case', claimType: 'TYPE-02', status: 'PROPOSAL', assignedUserId: 'USR-STAFF', deletedAt: now },
        { id: 'CASE-SYN-003', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0003', title: 'SYNTHETIC_CASE_03_UNASSIGNED_PM', description: 'Sample case 3', claimType: 'TYPE-03', status: 'ANALYSIS', assignedUserId: 'USR-STAFF', deletedAt: null },
        { id: 'CASE-SYN-004', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0004', title: 'SYNTHETIC_CASE_04_TYPE4', description: 'Type 4 case', claimType: 'TYPE-04', status: 'SUBMITTED', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-005', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0005', title: 'SYNTHETIC_CASE_05_TYPE5', description: 'Type 5 case', claimType: 'TYPE-05', status: 'JUDGEMENT', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-006', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0006', title: 'SYNTHETIC_CASE_06_TYPE6', description: 'Type 6 case', claimType: 'TYPE-06', status: 'CLOSED', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-SAME-1', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0007', title: 'SYNTHETIC_DUPLICATE_CASE_TITLE', description: 'Synthetic duplicate case one', claimType: 'TYPE-01', status: 'CONTRACT', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-SAME-2', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0008', title: 'SYNTHETIC_DUPLICATE_CASE_TITLE', description: 'Synthetic duplicate case two', claimType: 'TYPE-02', status: 'MATERIAL_RECEIVED', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-LONG', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0009', title: 'A'.repeat(120), description: 'Synthetic long-title boundary fixture', claimType: 'TYPE-01', status: 'REPORT_DRAFTING', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-STRESS', organizationId: 'ORG-SYN-A', caseNumber: 'CASE-2026-0010', title: 'SYNTHETIC_STRESS_CASE', description: 'Synthetic fixture with 10 parties and 100 schedules', claimType: 'TYPE-01', status: 'LITIGATION', assignedUserId: 'USR-PM', deletedAt: null },
        { id: 'CASE-SYN-ORGB', organizationId: 'ORG-SYN-B', caseNumber: 'CASE-ORGB-0001', title: 'SYNTHETIC_CASE_ORGB', description: 'Org B private case', claimType: 'TYPE-03', status: 'ANALYSIS', assignedUserId: 'USR-ORGB-PM', deletedAt: null }
      ];

      for (const c of cases) {
        await tx.caseItem.upsert({
          where: { id: c.id },
          update: { ...c, version: 1, updatedAt: now },
          create: { ...c, version: 1, createdAt: now, updatedAt: now }
        });
      }

      // 6. Case Category
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

      // 8. Parties
      const parties = [
        { id: 'PARTY-SYN-001', caseId: 'CASE-SYN-004', name: 'SYNTHETIC_PARTY_01', role: 'CLAIMANT', contact: 'party01@example.invalid' }
      ];
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

      // 9. Schedules
      const schedules = [
        { id: 'SCHED-SYN-001', caseId: 'CASE-SYN-004', title: 'SYNTHETIC_COURT_DEADLINE', type: 'COURT', date: new Date('2026-03-01T10:00:00.000Z'), location: 'SYNTHETIC_COURT_ROOM', description: 'Synthetic cross-case schedule' }
      ];
      for (let i = 1; i <= 100; i++) {
        const types = ['COURT', 'CLIENT', 'INTERNAL'];
        const type = types[i % 3];
        let schedDate: Date;
        if (i === 1) {
          schedDate = new Date('2028-02-29T14:00:00.000Z');
        } else if (i === 2) {
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

      // 10. Status Histories
      const statusHistories = [
        { id: 'STHIST-SYN-001', caseId: 'CASE-SYN-001', fromStatus: null, toStatus: 'INQUIRY', changedById: 'USR-PM', reason: 'Synthetic case initialized' },
        { id: 'STHIST-SYN-002', caseId: 'CASE-SYN-003', fromStatus: null, toStatus: 'ANALYSIS', changedById: 'USR-PM', reason: 'Synthetic fixture initialized at analysis' }
      ];
      for (const sh of statusHistories) {
        const exists = await tx.statusHistory.findUnique({ where: { id: sh.id }, select: { id: true } });
        if (!exists) await tx.statusHistory.create({ data: { ...sh, createdAt: now } });
      }

      // 11. P06 Documents & Document Versions
      const docs = [
        { id: 'DOC-SYN-001', caseId: 'CASE-SYN-001', scheduleId: null, title: 'SYNTHETIC_DOC_PROPOSAL', category: 'PROPOSAL', source: 'AUTHORED', currentVersionId: 'DOCVER-SYN-002', finalVersionId: 'DOCVER-SYN-002' },
        { id: 'DOC-SYN-002', caseId: 'CASE-SYN-004', scheduleId: null, title: 'SYNTHETIC_DOC_EVIDENCE', category: 'EVIDENCE', source: 'RECEIVED', currentVersionId: 'DOCVER-SYN-003', finalVersionId: 'DOCVER-SYN-003' }
      ];
      for (const d of docs) {
        const existing = await tx.document.findUnique({ where: { id: d.id }, select: { id: true } });
        if (!existing) {
          await tx.document.create({ data: {
            id: d.id, caseId: d.caseId, scheduleId: d.scheduleId, title: d.title, category: d.category,
            source: d.source, currentVersionId: null, finalVersionId: null, version: 1,
            createdAt: now, updatedAt: now
          } });
        }
      }

      const docVersions = [
        {
          id: 'DOCVER-SYN-001', documentId: 'DOC-SYN-001', versionNumber: 1, originalName: 'SYNTHETIC_PROPOSAL_v01.pdf', displayName: 'CASE-2026-0001_PROPOSAL_SyntheticProposal_20260101_v01.pdf',
          storageKey: 'storage-00000000-0000-4000-8000-000000000001.pdf', fileSize: 1024, mimeType: 'application/pdf', sha256: 'a'.repeat(64), isFinal: false, uploadedById: 'USR-PM'
        },
        {
          id: 'DOCVER-SYN-002', documentId: 'DOC-SYN-001', versionNumber: 2, originalName: 'SYNTHETIC_PROPOSAL_v02.pdf', displayName: 'CASE-2026-0001_PROPOSAL_SyntheticProposal_20260101_v02.pdf',
          storageKey: 'storage-00000000-0000-4000-8000-000000000002.pdf', fileSize: 2048, mimeType: 'application/pdf', sha256: 'b'.repeat(64), isFinal: true, uploadedById: 'USR-PM'
        },
        {
          id: 'DOCVER-SYN-003', documentId: 'DOC-SYN-002', versionNumber: 1, originalName: 'SYNTHETIC_EVIDENCE_v01.png', displayName: 'CASE-2026-0004_EVIDENCE_ReceivedEvidence_20260101_v01.png',
          storageKey: 'storage-00000000-0000-4000-8000-000000000003.png', fileSize: 4096, mimeType: 'image/png', sha256: 'c'.repeat(64), isFinal: true, uploadedById: 'USR-STAFF'
        }
      ];
      for (const dv of docVersions) {
        await tx.documentVersion.upsert({
          where: { id: dv.id },
          update: { ...dv },
          create: { ...dv, createdAt: now }
        });
      }
      for (const d of docs) {
        await tx.document.update({
          where: { id: d.id },
          data: { currentVersionId: d.currentVersionId, finalVersionId: d.finalVersionId, updatedAt: now }
        });
      }

      // 12. P06 Meetings & Meeting Action Items
      const meetings = [
        {
          id: 'MEET-SYN-001', caseId: 'CASE-SYN-001', title: 'SYNTHETIC_MEETING_01', meetingDate: new Date('2026-02-01T10:00:00.000Z'),
          location: 'SYNTHETIC_ROOM_01', attendees: 'SYNTHETIC_ATTENDEES', rawText: 'Synthetic meeting raw transcript text',
          rawTextSha256: crypto.createHash('sha256').update('Synthetic meeting raw transcript text').digest('hex'),
          summary: 'Synthetic summary text', decisions: 'Synthetic decisions text', status: 'DRAFT', version: 1, createdById: 'USR-PM'
        },
        {
          id: 'MEET-SYN-002', caseId: 'CASE-SYN-001', title: 'SYNTHETIC_MEETING_FINAL_02', meetingDate: new Date('2026-02-15T14:00:00.000Z'),
          location: 'SYNTHETIC_ROOM_02', attendees: 'SYNTHETIC_EXECUTIVE_ATTENDEES', rawText: 'Synthetic final raw transcript text',
          rawTextSha256: crypto.createHash('sha256').update('Synthetic final raw transcript text').digest('hex'),
          summary: 'Synthetic final summary', decisions: 'Synthetic final decisions', status: 'FINAL', version: 1, createdById: 'USR-PM'
        }
      ];
      for (const m of meetings) {
        const exists = await tx.meeting.findUnique({ where: { id: m.id }, select: { id: true } });
        if (!exists) {
          await tx.meeting.create({ data: { ...m, createdAt: now, updatedAt: now } });
        }
      }

      const actionItems = [
        {
          id: 'ACT-SYN-001', meetingId: 'MEET-SYN-001', title: 'Synthetic Action Item 1', assigneeId: 'USR-PM', scheduleId: null,
          dueDate: new Date('2026-03-01T10:00:00.000Z'), status: 'PENDING'
        }
      ];
      for (const ai of actionItems) {
        await tx.meetingActionItem.upsert({
          where: { id: ai.id },
          update: { ...ai, updatedAt: now },
          create: { ...ai, createdAt: now, updatedAt: now }
        });
      }

      // 13. Reports & Report Sections
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

      // 14. P07 Proposal Templates & Proposals
      const proposalPlaceholders = [
        'CASE_NUMBER', 'CASE_TITLE', 'CLAIM_TYPE', 'ASSIGNED_USER', 'CLIENT_NAME', 'CREATED_DATE',
        'BACKGROUND', 'OBJECTIVE', 'METHOD', 'EXPECTED_OUTCOME', 'EXCLUSIONS'
      ];
      const proposalTemplates = [
        {
          id: 'TPL-PROP-TYPE-01',
          name: '현장조사 및 수량산출 클레임 제안서 템플릿',
          claimType: 'TYPE-01',
          description: 'TYPE-01 현장조사 및 수량산출 전문 클레임 기술제안서 표준 템플릿',
          bodyTemplate: `[제안서] {{CASE_TITLE}} (사건번호: {{CASE_NUMBER}} / 유형: {{CLAIM_TYPE}})\n의뢰인: {{CLIENT_NAME}}\n1. 의뢰 배경\n{{BACKGROUND}}\n2. 수행 목적\n{{OBJECTIVE}}\n3. 수행 방법 및 수량산출 범위\n{{METHOD}}\n4. 예상 성과물 및 제출 기한\n{{EXPECTED_OUTCOME}}\n5. 제외 사항\n{{EXCLUSIONS}}\n담당자: {{ASSIGNED_USER}} / 작성일: {{CREATED_DATE}}`,
          placeholdersJson: JSON.stringify(proposalPlaceholders),
          version: 1
        },
        {
          id: 'TPL-PROP-TYPE-02',
          name: '분석 보고서 작성 클레임 제안서 템플릿',
          claimType: 'TYPE-02',
          description: 'TYPE-02 분석 보고서 작성 클레임 표준 템플릿',
          bodyTemplate: `[제안서] {{CASE_TITLE}} (사건번호: {{CASE_NUMBER}} / 유형: {{CLAIM_TYPE}})\n의뢰인: {{CLIENT_NAME}}\n1. 분석 배경\n{{BACKGROUND}}\n2. 수행 목적\n{{OBJECTIVE}}\n3. 분석 방법론\n{{METHOD}}\n4. 성과물\n{{EXPECTED_OUTCOME}}\n5. 제외사항\n{{EXCLUSIONS}}`,
          placeholdersJson: JSON.stringify(proposalPlaceholders),
          version: 1
        },
        {
          id: 'TPL-PROP-TYPE-03',
          name: '일반 클레임 제안서 템플릿',
          claimType: 'TYPE-03',
          description: 'TYPE-03 일반 클레임 표준 템플릿',
          bodyTemplate: `[제안서] {{CASE_TITLE}} (사건번호: {{CASE_NUMBER}} / 유형: {{CLAIM_TYPE}})\n의뢰인: {{CLIENT_NAME}}\n1. 의뢰 개요\n{{BACKGROUND}}\n2. 수행 목적\n{{OBJECTIVE}}\n3. 수행 전략\n{{METHOD}}\n4. 성과물\n{{EXPECTED_OUTCOME}}\n5. 유의사항\n{{EXCLUSIONS}}`,
          placeholdersJson: JSON.stringify(proposalPlaceholders),
          version: 1
        },
        {
          id: 'TPL-PROP-TYPE-04',
          name: '재건축·재개발 공사비 협상 제안서 템플릿',
          claimType: 'TYPE-04',
          description: 'TYPE-04 공사비 협상 클레임 표준 템플릿',
          bodyTemplate: `[제안서] {{CASE_TITLE}} (사건번호: {{CASE_NUMBER}} / 유형: {{CLAIM_TYPE}})\n의뢰인: {{CLIENT_NAME}}\n1. 협상 배경\n{{BACKGROUND}}\n2. 수행 목적\n{{OBJECTIVE}}\n3. 검증 방법론\n{{METHOD}}\n4. 협상 목표\n{{EXPECTED_OUTCOME}}\n5. 제외조건\n{{EXCLUSIONS}}`,
          placeholdersJson: JSON.stringify(proposalPlaceholders),
          version: 1
        },
        {
          id: 'TPL-PROP-TYPE-05',
          name: '사감정보고서 제안서 템플릿',
          claimType: 'TYPE-05',
          description: 'TYPE-05 사감정보고서 표준 템플릿',
          bodyTemplate: `[제안서] {{CASE_TITLE}} (사건번호: {{CASE_NUMBER}} / 유형: {{CLAIM_TYPE}})\n의뢰인: {{CLIENT_NAME}}\n1. 감정 개요\n{{BACKGROUND}}\n2. 수행 목적\n{{OBJECTIVE}}\n3. 감정 절차\n{{METHOD}}\n4. 예상 결과서\n{{EXPECTED_OUTCOME}}\n5. 한계사항\n{{EXCLUSIONS}}`,
          placeholdersJson: JSON.stringify(proposalPlaceholders),
          version: 1
        },
        {
          id: 'TPL-PROP-TYPE-06',
          name: '물가변동 클레임 제안서 템플릿',
          claimType: 'TYPE-06',
          description: 'TYPE-06 물가변동 조정 산출 클레임 템플릿',
          bodyTemplate: `[제안서] {{CASE_TITLE}} (사건번호: {{CASE_NUMBER}} / 유형: {{CLAIM_TYPE}})\n의뢰인: {{CLIENT_NAME}}\n1. 산출 배경\n{{BACKGROUND}}\n2. 수행 목적\n{{OBJECTIVE}}\n3. 등율/품목 산출법\n{{METHOD}}\n4. 조정 성과물\n{{EXPECTED_OUTCOME}}\n5. 면책사항\n{{EXCLUSIONS}}`,
          placeholdersJson: JSON.stringify(proposalPlaceholders),
          version: 1
        }
      ];

      for (const tpl of proposalTemplates) {
        await tx.proposalTemplate.upsert({
          where: { id: tpl.id },
          update: { ...tpl, updatedAt: now },
          create: { ...tpl, createdAt: now, updatedAt: now }
        });
      }

      const prop1Id = 'PROP-SYN-001';
      const prop2Id = 'PROP-SYN-002';

      await tx.proposal.upsert({
        where: { id: prop1Id },
        update: {},
        create: {
          id: prop1Id, caseId: 'CASE-SYN-001', templateId: 'TPL-PROP-TYPE-01', templateVersionSnapshot: 1,
          templateBodySnapshot: proposalTemplates[0].bodyTemplate, templatePlaceholdersSnapshotJson: proposalTemplates[0].placeholdersJson,
          title: 'SYNTHETIC_PROPOSAL_01', status: 'DRAFT', version: 2,
          createdById: 'USR-PM', updatedById: 'USR-PM', createdAt: now, updatedAt: now
        }
      });

      const v1Body = '[제안서] SYNTHETIC_CASE_01\n1. 의뢰 배경: 수량산출 재검토\n2. 수행 방법: 현장 실측\n3. 성과물: 보고서\n4. 제외사항: 없음';
      const v2Body = '[제안서 AI] SYNTHETIC_CASE_01\n1. 의뢰 배경: [AI 생성] 수량산출 정밀 분석\n2. 수행 방법: BIM 수량산출\n3. 성과물: 최종 제안서\n4. 제외사항: 없음';

      await tx.proposalVersion.upsert({
        where: { id: 'PROPVER-SYN-001' },
        update: {},
        create: {
          id: 'PROPVER-SYN-001', proposalId: prop1Id, versionNumber: 1, bodyText: v1Body,
          structuredInputsJson: JSON.stringify({ background: '수량산출 재검토', objective: '정확도 검증', method: '현장 실측', expectedOutcome: '보고서', exclusions: '없음' }),
          renderedValuesJson: JSON.stringify({ CASE_TITLE: 'SYNTHETIC_CASE_01', CASE_NUMBER: 'CASE-2026-0001' }),
          missingFieldsJson: JSON.stringify([]), generationMode: 'MANUAL', providerId: null, modelId: null,
          promptConfigVersion: null, inputSha256: crypto.createHash('sha256').update(JSON.stringify({ background: '수량산출 재검토', objective: '정확도 검증', method: '현장 실측', expectedOutcome: '보고서', exclusions: '없음' })).digest('hex'), generatedAt: null,
          sourceDocumentVersionIdsJson: JSON.stringify([]),
          sha256: crypto.createHash('sha256').update(v1Body).digest('hex'), isApproved: false, createdById: 'USR-PM', createdAt: now
        }
      });

      await tx.proposalVersion.upsert({
        where: { id: 'PROPVER-SYN-002' },
        update: {},
        create: {
          id: 'PROPVER-SYN-002', proposalId: prop1Id, versionNumber: 2, bodyText: v2Body,
          structuredInputsJson: JSON.stringify({ background: '[AI 생성] 수량산출 정밀 분석', objective: '정확도 검증', method: 'BIM 수량산출', expectedOutcome: '최종 제안서', exclusions: '없음' }),
          renderedValuesJson: JSON.stringify({ CASE_TITLE: 'SYNTHETIC_CASE_01', CASE_NUMBER: 'CASE-2026-0001' }),
          missingFieldsJson: JSON.stringify([]), generationMode: 'AI', providerId: 'local-fake-ai', modelId: 'fake-claim-v1',
          promptConfigVersion: 'v1.0', inputSha256: crypto.createHash('sha256').update(JSON.stringify({ background: '[AI 생성] 수량산출 정밀 분석', objective: '정확도 검증', method: 'BIM 수량산출', expectedOutcome: '최종 제안서', exclusions: '없음' })).digest('hex'), generatedAt: now,
          sourceDocumentVersionIdsJson: JSON.stringify([]),
          sha256: crypto.createHash('sha256').update(v2Body).digest('hex'), isApproved: false, createdById: 'USR-PM', createdAt: now
        }
      });

      await tx.proposal.update({ where: { id: prop1Id }, data: { currentVersionId: 'PROPVER-SYN-002' } });

      await tx.proposal.upsert({
        where: { id: prop2Id },
        update: {},
        create: {
          id: prop2Id, caseId: 'CASE-SYN-001', templateId: 'TPL-PROP-TYPE-01', templateVersionSnapshot: 1,
          templateBodySnapshot: proposalTemplates[0].bodyTemplate, templatePlaceholdersSnapshotJson: proposalTemplates[0].placeholdersJson,
          title: 'SYNTHETIC_PROPOSAL_APPROVED_02', status: 'DRAFT', version: 1,
          createdById: 'USR-PM', updatedById: 'USR-DIRECTOR', createdAt: now, updatedAt: now
        }
      });

      const v3Body = '[승인된 제안서] SYNTHETIC_CASE_01\n1. 의뢰 배경: 최종 승인문서\n2. 수행 방법: 현장검증\n3. 성과물: DOCX/PDF\n4. 제외사항: 없음';
      await tx.proposalVersion.upsert({
        where: { id: 'PROPVER-SYN-003' },
        update: {},
        create: {
          id: 'PROPVER-SYN-003', proposalId: prop2Id, versionNumber: 1, bodyText: v3Body,
          structuredInputsJson: JSON.stringify({ background: '최종 승인문서', objective: '승인', method: '현장검증', expectedOutcome: 'DOCX/PDF', exclusions: '없음' }),
          renderedValuesJson: JSON.stringify({ CASE_TITLE: 'SYNTHETIC_CASE_01', CASE_NUMBER: 'CASE-2026-0001' }),
          missingFieldsJson: JSON.stringify([]), generationMode: 'MANUAL', providerId: null, modelId: null,
          promptConfigVersion: null, inputSha256: crypto.createHash('sha256').update(JSON.stringify({ background: '최종 승인문서', objective: '승인', method: '현장검증', expectedOutcome: 'DOCX/PDF', exclusions: '없음' })).digest('hex'), generatedAt: null,
          sourceDocumentVersionIdsJson: JSON.stringify([]),
          sha256: crypto.createHash('sha256').update(v3Body).digest('hex'), isApproved: false, createdById: 'USR-PM', createdAt: now
        }
      });

      const approvedFixtureVersion = await tx.proposalVersion.findUniqueOrThrow({ where: { id: 'PROPVER-SYN-003' } });
      if (!approvedFixtureVersion.isApproved) {
        await tx.proposalVersion.update({ where: { id: 'PROPVER-SYN-003' }, data: { isApproved: true } });
      }
      const approvedFixtureProposal = await tx.proposal.findUniqueOrThrow({ where: { id: prop2Id } });
      if (approvedFixtureProposal.status === 'DRAFT') {
        await tx.proposal.update({ where: { id: prop2Id }, data: { status: 'IN_REVIEW', currentVersionId: 'PROPVER-SYN-003' } });
        await tx.proposal.update({ where: { id: prop2Id }, data: { status: 'APPROVED', approvedVersionId: 'PROPVER-SYN-003' } });
      }

      await tx.proposalReview.upsert({
        where: { id: 'PROPREV-SYN-001' },
        update: {},
        create: {
          id: 'PROPREV-SYN-001', proposalId: prop2Id, versionId: 'PROPVER-SYN-003', reviewerId: 'USR-DIRECTOR',
          action: 'APPROVE', comment: 'Synthetic proposal approved by Director', createdAt: now
        }
      });

      // 15. P08 Block Definitions
      const blockDefs = [
        { code: 'OVERVIEW', name: '검토 개요', description: '사건 개요 및 검토 목적', schemaJson: JSON.stringify({ type: 'object', properties: { summary: { type: 'string' } } }) },
        { code: 'CONTRACT', name: '계약 현황', description: '공사/용역 계약 정보 및 조건', schemaJson: JSON.stringify({ type: 'object', properties: { contractAmount: { type: 'number' } } }) },
        { code: 'FACTS', name: '사실관계', description: '일지 및 경과 사실 정리', schemaJson: JSON.stringify({ type: 'object', properties: { timeline: { type: 'array' } } }) },
        { code: 'PHOTO_ANALYSIS', name: '사진 분석', description: '현장 사진 및 도면 대조 분석', schemaJson: JSON.stringify({ type: 'object', properties: { photos: { type: 'array' } } }) },
        { code: 'COST_CALC', name: '산출근거', description: '클레임 금액 및 내역 산출 내역', schemaJson: JSON.stringify({ type: 'object', properties: { items: { type: 'array' } } }) },
        { code: 'LEGAL_REVIEW', name: '법률 검토', description: '관련 법령 및 판례 검토', schemaJson: JSON.stringify({ type: 'object', properties: { precedents: { type: 'array' } } }) },
        { code: 'OPINION', name: '의견', description: '전문가 종합 의견', schemaJson: JSON.stringify({ type: 'object', properties: { opinionText: { type: 'string' } } }) },
        { code: 'CONCLUSION', name: '결론', description: '최종 결론 및 제언', schemaJson: JSON.stringify({ type: 'object', properties: { conclusionText: { type: 'string' } } }) }
      ];

      for (const bd of blockDefs) {
        await tx.blockDefinition.upsert({
          where: { code: bd.code },
          update: { name: bd.name, description: bd.description, schemaJson: bd.schemaJson, updatedAt: now },
          create: { id: `BLK-${bd.code}`, code: bd.code, name: bd.name, description: bd.description, schemaJson: bd.schemaJson, createdAt: now, updatedAt: now }
        });
      }

      // 16. P08 Reference Inventory (32 익명 레코드, 사전 승인은 0건이고 모두 REVIEW_REQUIRED)
      const EXPECTED_EXACT_SHAS: Record<string, string> = {
        'TPL-REF-001': '793cf78dd4262af8ddfddc77b85e5052f379e76d9e30f437cb799b9c43cec40a',
        'TPL-REF-002': '07e6483b00146f2aae5440e426e67e0c3a109dfd03b5e4ceb45dd3c1da222863',
        'TPL-REF-003': '33d47c460c30f5df150d0c213e16b02bad32af118932d7509e92521ef3d3656c',
        'TPL-REF-004': '2841c45be4cb33c376196415a942dd67bbc5a4a63ed4167548c50c18ead02818',
        'TPL-REF-005': '79bdd80d6ea68e2bdbe1d5eb79b082c12fbcd7dfc41d8a17f8e0af6cb15bc8b9',
        'TPL-REF-006': '799f600cc28b85a2d9b3de0b4e4e30160f4ca016891346bbdc955d7ba09a48cb',
        'TPL-REF-007': '803a7dac76f5dfb641d6ed09545bd8c3e1bc705e70fc3d6c313d9bdcc9a5862a',
        'TPL-REF-008': 'b5fc68e971e16c0dc10afdad52ade68466d79f49c5c6632c8bd6746b9b3f733c',
        'TPL-REF-009': '54916152527b6669d0b984e1452913369029b749e168396bbf89193174358e73',
        'TPL-REF-010': '48e695fc178c9c5ab7e1922accc11085fad8ffa90a83801dc31988a1212392b5',
        'TPL-REF-011': '704d15f89b301236454ff745a320abfd07a9f81dfe59f01ac80c1200a5a3ab08',
        'TPL-REF-012': 'b2fa6c4b8d73139b362ec7bf8bf3a0830079d546046e186e5fecf4271cce0589',
        'TPL-REF-013': 'cf615ffc0de836aa17238ce06f432efd2054554d24e3adeb3a95d028429073e7',
        'TPL-REF-014': '3cfe73cd7abfd509ecb59c2d01f4d4dd6016d295d504bc7ba83fe268ab2f8912',
        'TPL-REF-015': '295323489bfccd6b6a87287c2670756cf5f3f6114ce20a6b6863fa28ed709611',
        'TPL-REF-016': 'aae869dd91d5466d7c9553c124efd1cc26da2bfb8543b247c2ad3d5b53a8a54e',
        'TPL-REF-017': '46654b6954f7db138db189e90a256ebaab9721f8089f20536236e0690fa6f538',
        'TPL-REF-018': 'af54833985f8e95683c8fb4c7e5daf07d8c5bef9a5c33187c12c26028cb240e5',
        'TPL-REF-019': '5b250214112613ba64344bc07fd42c35a8b02658a48c1a0161e85f329e64d175',
        'TPL-REF-020': '4f11c2e0a80a2a48ebc1c9c4d7fd5a7903a1ee7eeec33741969e81fd13dd835b',
        'TPL-REF-021': 'c2b08275275061270eeebd87ad2834cdb93686d8f5079805fee1c156d555c22b',
        'TPL-REF-022': 'b92bd57ca313180477328c38f1997090662f45851aa1fea8a2080d3410d8840b',
        'TPL-REF-023': 'b46af144ac4530f510b2bb4545bc5060713aa59e58143d56137c50d6843737fa',
        'TPL-REF-024': '2392e4723cdae1e26e111bffd27f463389de6ef9b0203b5894a7de27a3345534',
        'TPL-REF-025': '281822dcaab11013dbf8a4d05ede709cad9763504cb411319fb6b0db71830dc5',
        'TPL-REF-026': '036c826bab836a83962c1878bc7c8b5ee18d0120f3bf146ec535fbe7923d68be',
        'TPL-REF-027': '62bc005ed3a99120cfb631dfac47ce694f68d52a3ad73ee528a2eda6a87abb3b',
        'TPL-REF-028': 'a8c1e0294ead3b86e5e7dc0eff30054d92a501b93dc518ccc559fd4365fcb4b1',
        'TPL-REF-029': 'a0c647b7892a4078b24cc670f33329007a45877f8e8df3cb43b2516dbe54a644',
        'TPL-REF-030': '88babe364a7cacfbb1b5e25356f80c0bc6583cfc7a0c215346a5732117665c39',
        'TPL-REF-031': '602861a42ba7ed0e96842eb40c811073942086fb9213ed8c938bef7a5d7a3bf2',
        'TPL-REF-032': '017b8fb3aac57469b51ee8cc43cca7c58a56e58e49f31c6a38f9beaa42a9f707'
      };

      for (let i = 1; i <= 32; i++) {
        const fileId = `TPL-REF-${String(i).padStart(3, '0')}`;
        const sha256 = EXPECTED_EXACT_SHAS[fileId];
        await tx.referenceInventory.upsert({
          where: { fileId },
          update: { sha256, scanStatus: 'UNSCANNED', approvalStatus: 'REVIEW_REQUIRED', updatedAt: now },
          create: { id: fileId, fileId, sha256, fileSize: 1024 * i, scanStatus: 'UNSCANNED', approvalStatus: 'REVIEW_REQUIRED', createdAt: now, updatedAt: now }
        });
      }

      // NOTE: Production seed의 ACTIVE 템플릿 수는 지침에 따라 정확히 0개!
      // TYPE-05 템플릿/버전/매핑 역시 0개!

      // Initial Audit Log for P08
      await tx.auditLog.upsert({
        where: { id: 'AUD-SYN-P08' },
        update: {},
        create: {
          id: 'AUD-SYN-P08', organizationId: 'ORG-SYN-A', userId: 'USR-ADMIN', action: 'SEED_INITIALIZED_P08',
          targetEntity: 'System', targetId: 'P08', metadataJson: JSON.stringify({ source: 'synthetic-seed-p08', activeTemplateCount: 0 }), createdAt: now
        }
      });
    });
  } finally {
    await db.$disconnect();
  }
  console.log('Database seeded with deterministic synthetic P08 fixtures.');
}

if (require.main === module) {
  void seedDatabase().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

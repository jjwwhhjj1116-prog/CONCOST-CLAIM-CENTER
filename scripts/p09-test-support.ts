import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { PrismaClient } from '@claim-studio/database';

export const P09_TEST_ORIGIN = 'http://127.0.0.1:43179';

export interface TestSession { cookie: string; csrf: string }
export interface JsonResult {
  status: number;
  body: Record<string, any>;
  headers: http.IncomingHttpHeaders;
}

export function requestJson(
  apiOrigin: string,
  pathname: string,
  method = 'GET',
  body?: unknown,
  session?: TestSession,
  requestOrigin = P09_TEST_ORIGIN
): Promise<JsonResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const request = http.request(`${apiOrigin}${pathname}`, {
      method,
      headers: {
        Origin: requestOrigin,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {})
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: response.statusCode ?? 500,
          body: raw.length > 0 && String(response.headers['content-type']).includes('application/json')
            ? JSON.parse(raw.toString('utf8'))
            : {},
          headers: response.headers
        });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

export async function login(apiOrigin: string, email: string, requestOrigin = P09_TEST_ORIGIN): Promise<TestSession> {
  const response = await requestJson(apiOrigin, '/auth/login', 'POST', { email, password: 'Password123!' }, undefined, requestOrigin);
  assert.strictEqual(response.status, 200, `${email} login failed: ${JSON.stringify(response.body)}`);
  return {
    cookie: (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; '),
    csrf: response.body.csrfToken
  };
}

export interface P09Fixture {
  reportId: string;
  reportInstanceId: string;
  templateId: string;
  templateVersionId: string;
  sectionIds: string[];
  admin: TestSession;
  director: TestSession;
  pm: TestSession;
  reviewer: TestSession;
  staff: TestSession;
}

export async function createP09Fixture(
  apiOrigin: string,
  db: PrismaClient,
  options: { sectionCount?: number; requestOrigin?: string } = {}
): Promise<P09Fixture> {
  const sectionCount = options.sectionCount ?? 3;
  if (!Number.isInteger(sectionCount) || sectionCount < 1 || sectionCount > 100) throw new Error('sectionCount must be 1..100');
  const requestOrigin = options.requestOrigin ?? P09_TEST_ORIGIN;
  const [admin, director, pm, reviewer, staff] = await Promise.all([
    login(apiOrigin, 'admin@example.invalid', requestOrigin),
    login(apiOrigin, 'director@example.invalid', requestOrigin),
    login(apiOrigin, 'pm@example.invalid', requestOrigin),
    login(apiOrigin, 'reviewer@example.invalid', requestOrigin),
    login(apiOrigin, 'staff@example.invalid', requestOrigin)
  ]);
  const sections = Array.from({ length: sectionCount }, (_, index) => `P09 검증 장 ${String(index + 1).padStart(3, '0')}`);
  const blockSchemas = Object.fromEntries(sections.map((title) => [title, { blockCode: 'executive-summary', config: { p09: true } }]));
  const unique = `${process.pid}-${Date.now()}-${sectionCount}`;
  const draft = await requestJson(apiOrigin, '/api/report-templates', 'POST', {
    code: `P09-${unique}`,
    name: `P09 synthetic ${sectionCount}-section template`,
    description: 'Synthetic P09 report studio test template',
    companyForm: 'P09 deterministic company form',
    primaryType: 'TYPE-01',
    secondaryTypes: [],
    tocStructure: sections,
    requiredSections: sections,
    requiredEvidenceRules: ['수치·법률·금액 단락의 근거 연결'],
    blockSchemas,
    referenceFileIds: []
  }, admin, requestOrigin);
  assert.strictEqual(draft.status, 201, `P09 template creation failed: ${JSON.stringify(draft.body)}`);
  const templateId = draft.body.template.id as string;
  const templateVersionId = draft.body.version.id as string;
  const approved = await requestJson(
    apiOrigin,
    `/api/report-templates/${templateId}/versions/${templateVersionId}/approve`,
    'POST',
    { expectedRowVersion: 1 },
    director,
    requestOrigin
  );
  assert.strictEqual(approved.status, 200, `P09 template approval failed: ${JSON.stringify(approved.body)}`);
  const activated = await requestJson(
    apiOrigin,
    `/api/report-templates/${templateId}/versions/${templateVersionId}/activate`,
    'POST',
    { expectedRowVersion: 2 },
    director,
    requestOrigin
  );
  assert.strictEqual(activated.status, 200, `P09 template activation failed: ${JSON.stringify(activated.body)}`);
  const caseVersion = (await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } })).version;
  const instance = await requestJson(apiOrigin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
    templateVersionId,
    expectedCaseVersion: caseVersion
  }, pm, requestOrigin);
  assert.strictEqual(instance.status, 201, `P09 ReportInstance creation failed: ${JSON.stringify(instance.body)}`);
  assert.strictEqual(instance.body.sections.length, sectionCount);
  return {
    reportId: instance.body.report.id,
    reportInstanceId: instance.body.instance.id,
    templateId,
    templateVersionId,
    sectionIds: instance.body.sections.map((section: { id: string }) => section.id),
    admin,
    director,
    pm,
    reviewer,
    staff
  };
}

export function revisionPayload(
  expectedVersion: number,
  content: string,
  options: { withMeetingEvidence?: boolean; saveMode?: 'AUTO' | 'MANUAL' } = {}
): Record<string, unknown> {
  return {
    content,
    structuredDataJson: '{}',
    expectedVersion,
    saveMode: options.saveMode ?? 'MANUAL',
    evidenceLinks: options.withMeetingEvidence ? [{
      sourceType: 'MEETING',
      sourceId: 'MEET-SYN-002',
      targetParagraphIndex: 0,
      quoteText: 'Synthetic final raw transcript text',
      anchorPosition: 'transcript:paragraph-1'
    }] : []
  };
}

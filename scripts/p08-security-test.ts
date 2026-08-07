import { createPrismaClient, getDatabaseUrl } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

export async function runP08SecurityTests(): Promise<void> {
  console.log('[P08-SECURITY] Running P08 Security & Adversarial Tests...');

  const dbUrl = getDatabaseUrl();
  const db = createPrismaClient(dbUrl);
  const server = createApiServer({ databaseUrl: dbUrl, allowedOrigins: ['http://localhost:3000'] });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Helper: Login & get headers
    const getAuthHeaders = async (email: string) => {
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, password: 'Password123!' })
      });
      if (!loginRes.ok) throw new Error(`Login failed for ${email}`);
      const cookies = loginRes.headers.getSetCookie();
      const sessionToken = cookies.find((c) => c.startsWith('session_token='))?.split(';')[0].split('=')[1];
      const csrfToken = cookies.find((c) => c.startsWith('csrf_token='))?.split(';')[0].split('=')[1];

      return {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: `session_token=${sessionToken}; csrf_token=${csrfToken}`,
        'X-CSRF-Token': csrfToken || ''
      };
    };

    const adminHeaders = await getAuthHeaders('admin@example.invalid');
    const ceoHeaders = await getAuthHeaders('ceo@example.invalid');
    const pmHeaders = await getAuthHeaders('pm@example.invalid');
    const staffHeaders = await getAuthHeaders('staff@example.invalid');
    const reviewerHeaders = await getAuthHeaders('reviewer@example.invalid');
    const orgBHeaders = await getAuthHeaders('pm_b@example.invalid');

    // 2. Test: Non-Admin Template Creation Prohibition (Staff/PM/Reviewer -> 403)
    console.log('Testing Non-Admin template creation prohibition...');
    for (const [roleName, headers] of [
      ['Staff', staffHeaders],
      ['PM', pmHeaders],
      ['Reviewer', reviewerHeaders]
    ] as const) {
      const res = await fetch(`${baseUrl}/api/report-templates`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: `RPT-FORBID-${roleName}`,
          name: 'Forbidden Template',
          companyForm: 'Form',
          primaryType: 'TYPE-01'
        })
      });
      if (res.status !== 403) {
        throw new Error(`[P08-SECURITY] ${roleName} should receive 403 on template creation, got ${res.status}`);
      }
    }

    // 3. Test: TYPE-05 Template Creation Prohibition (400)
    console.log('Testing TYPE-05 template creation prohibition...');
    const type05Res = await fetch(`${baseUrl}/api/report-templates`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        code: 'RPT-TYPE05-BAD',
        name: 'Forbidden TYPE-05 Template',
        companyForm: 'Form',
        primaryType: 'TYPE-05'
      })
    });
    if (type05Res.status !== 400) {
      throw new Error(`[P08-SECURITY] TYPE-05 template creation must fail with 400, got ${type05Res.status}`);
    }

    // 4. Test: Admin Create DRAFT Template & Creator Self-Approval Prohibition
    console.log('Testing Creator Self-Approval Prohibition (API & DB Trigger)...');
    const createRes = await fetch(`${baseUrl}/api/report-templates`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        code: `RPT-SEC-${Date.now()}`,
        name: 'Security Test Template',
        companyForm: 'Security Form v1',
        primaryType: 'TYPE-01',
        tocStructure: ['개요', '분석', '결론']
      })
    });
    if (!createRes.ok) throw new Error('[P08-SECURITY] Admin template creation failed');
    const createdData = (await createRes.json()) as { template: { id: string }; version: { id: string } };

    // Admin tries self-approval via API (Admin is creator USR-ADMIN)
    // Note: Admin has roles ['admin']. Only CEO/Director are allowed to approve.
    // If Admin tries approval -> 403 (Role mismatch or Creator self-approval)
    const selfApproveRes = await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/approve`, {
      method: 'POST',
      headers: adminHeaders
    });
    if (selfApproveRes.status !== 403) {
      throw new Error(`[P08-SECURITY] Admin self-approval should be rejected with 403, got ${selfApproveRes.status}`);
    }

    // DB Trigger Check: Directly attempt self-approval update in DB for USR-ADMIN
    let dbTriggerFired = false;
    try {
      await db.reportTemplateVersion.update({
        where: { id: createdData.version.id },
        data: { status: 'HUMAN_APPROVED', approvedById: 'USR-ADMIN', approvedAt: new Date() }
      });
    } catch (err) {
      dbTriggerFired = true;
      console.log('Successfully caught DB self-approval trigger exception:', (err as Error).message);
    }
    if (!dbTriggerFired) {
      throw new Error('[P08-SECURITY] DB trigger P08_report_template_version_no_self_approval failed to fire!');
    }

    // 5. CEO Approves Version
    console.log('Testing CEO approval & activation...');
    const ceoApproveRes = await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/approve`, {
      method: 'POST',
      headers: ceoHeaders
    });
    if (!ceoApproveRes.ok) throw new Error('[P08-SECURITY] CEO approval failed');

    // 6. Non-ACTIVE Version ReportInstance Creation Prohibition (400)
    console.log('Testing ReportInstance creation with non-ACTIVE (HUMAN_APPROVED) version prohibition...');
    const nonActiveInstRes = await fetch(`${baseUrl}/api/cases/CASE-SYN-001/report-instances`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({ templateVersionId: createdData.version.id })
    });
    if (nonActiveInstRes.status !== 400) {
      throw new Error(`[P08-SECURITY] Non-ACTIVE template version instance creation must fail with 400, got ${nonActiveInstRes.status}`);
    }

    // CEO Activates Version
    const ceoActivateRes = await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/activate`, {
      method: 'POST',
      headers: ceoHeaders
    });
    if (!ceoActivateRes.ok) throw new Error('[P08-SECURITY] CEO activation failed');

    // 7. Test DB Trigger: Prevent UPDATE of ACTIVE ReportTemplateVersion
    console.log('Testing DB trigger preventing UPDATE of ACTIVE ReportTemplateVersion...');
    let activeUpdateTriggerFired = false;
    try {
      await db.reportTemplateVersion.update({
        where: { id: createdData.version.id },
        data: { companyForm: 'Hacked Company Form' }
      });
    } catch {
      activeUpdateTriggerFired = true;
    }
    if (!activeUpdateTriggerFired) {
      throw new Error('[P08-SECURITY] DB trigger P08_report_template_version_no_update failed for ACTIVE version!');
    }

    // 8. PM Creates ReportInstance for CASE-SYN-001
    const pmInstRes = await fetch(`${baseUrl}/api/cases/CASE-SYN-001/report-instances`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({ templateVersionId: createdData.version.id })
    });
    if (!pmInstRes.ok) throw new Error('[P08-SECURITY] PM ReportInstance creation failed');
    const pmInstData = (await pmInstRes.json()) as { instance: { id: string } };

    // 9. Test DB Trigger: Prevent UPDATE of ReportInstance snapshot
    console.log('Testing DB trigger preventing UPDATE of ReportInstance snapshot...');
    let snapshotUpdateTriggerFired = false;
    try {
      await db.reportInstance.update({
        where: { id: pmInstData.instance.id },
        data: { companyFormSnapshot: 'Tampered Snapshot' }
      });
    } catch {
      snapshotUpdateTriggerFired = true;
    }
    if (!snapshotUpdateTriggerFired) {
      throw new Error('[P08-SECURITY] DB trigger P08_report_instance_no_snapshot_update failed!');
    }

    // 10. IDOR Test: Org B PM tries to create ReportInstance on Org A Case (403)
    console.log('Testing IDOR cross-tenant ReportInstance creation prohibition...');
    const idorRes = await fetch(`${baseUrl}/api/cases/CASE-SYN-001/report-instances`, {
      method: 'POST',
      headers: orgBHeaders,
      body: JSON.stringify({ templateVersionId: createdData.version.id })
    });
    if (idorRes.status !== 403) {
      throw new Error(`[P08-SECURITY] Cross-tenant ReportInstance creation should return 403, got ${idorRes.status}`);
    }

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.$disconnect();
  }

  console.log('[P08-SECURITY] All P08 security & adversarial tests passed successfully.');
}

if (require.main === module) {
  runP08SecurityTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

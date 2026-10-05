import type { EvidenceDatabase } from './evidence-versioning';

export interface EvidenceRetryApproval {
  operationId: string; category: string; requestFingerprint: string; approvedBy: string;
  approvedAt: string; expiresAt: string; replacementOperationId: string; replacementStatus: string | null;
  originalName: string; mimeType: string; byteSize: number; sha256: string;
}

export async function evidenceRetryApprovals(db: EvidenceDatabase, caseId: string): Promise<EvidenceRetryApproval[]> {
  try {
    return (await db.prepare(`SELECT a.operation_id AS operationId,o.workflow_category AS category,o.request_fingerprint AS requestFingerprint,
      a.approved_by AS approvedBy,a.approved_at AS approvedAt,a.expires_at AS expiresAt,a.replacement_operation_id AS replacementOperationId,
      n.status AS replacementStatus,a.original_name AS originalName,a.mime_type AS mimeType,a.byte_size AS byteSize,a.sha256
      FROM preview_google_case_retry_approvals a JOIN preview_google_case_operations o ON o.id=a.operation_id
      LEFT JOIN preview_google_case_operations n ON n.id=a.replacement_operation_id
      WHERE o.organization_id='concost' AND o.case_id=? AND o.status='RECONCILIATION_REQUIRED'`).bind(caseId).all<EvidenceRetryApproval>()).results;
  } catch (reason) {
    // Databases without the new migration keep their original blocking policy.
    if (/no such table.*preview_google_case_retry_approvals/iu.test(String(reason))) return [];
    throw reason;
  }
}

export function evidenceRetryAvailable(approval: EvidenceRetryApproval, userId: string, now = Date.now()): boolean {
  return approval.approvedBy === userId && approval.replacementStatus === null
    && now >= Date.parse(approval.approvedAt) && now < Date.parse(approval.expiresAt);
}

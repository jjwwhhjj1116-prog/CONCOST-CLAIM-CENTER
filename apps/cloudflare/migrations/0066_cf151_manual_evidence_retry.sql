-- Preserve the uncertain operation verbatim. This is manual consent, not proof of absence.
CREATE TABLE IF NOT EXISTS preview_google_case_retry_approvals (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES preview_google_case_operations(id),
  replacement_operation_id TEXT NOT NULL UNIQUE CHECK(length(replacement_operation_id)=36),
  approved_by TEXT NOT NULL REFERENCES preview_users(id),
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at>approved_at),
  decision TEXT NOT NULL CHECK(decision='MANUAL_RETRY_WITH_UNCERTAINTY'),
  operation_snapshot_json TEXT NOT NULL CHECK(json_valid(operation_snapshot_json)),
  original_name TEXT NOT NULL CHECK(length(original_name) BETWEEN 1 AND 240),
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 3 AND 160),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 10000000),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  backup_sha256 TEXT NOT NULL CHECK(length(backup_sha256)=64 AND backup_sha256 NOT GLOB '*[^0-9a-f]*'),
  review_note TEXT NOT NULL CHECK(length(review_note) BETWEEN 20 AND 3000)
);
CREATE TRIGGER IF NOT EXISTS preview_google_case_retry_approval_insert_guard
BEFORE INSERT ON preview_google_case_retry_approvals BEGIN
  SELECT RAISE(ABORT,'manual retry requires an exact unresolved operation and active administrator') WHERE NOT EXISTS (
    SELECT 1 FROM preview_google_case_operations o
    JOIN preview_cases c ON c.id=o.case_id AND c.organization_id=o.organization_id AND c.deleted_at IS NULL
    JOIN preview_users u ON u.id=NEW.approved_by AND u.is_active=1
    WHERE o.id=NEW.operation_id AND o.status='RECONCILIATION_REQUIRED' AND o.google_file_id IS NULL
      AND o.created_by=NEW.approved_by
      AND EXISTS(SELECT 1 FROM json_each(u.roles_json) WHERE value='admin')
      AND json_extract(NEW.operation_snapshot_json,'$.id')=o.id
      AND json_extract(NEW.operation_snapshot_json,'$.organization_id')=o.organization_id
      AND json_extract(NEW.operation_snapshot_json,'$.case_id')=o.case_id
      AND json_extract(NEW.operation_snapshot_json,'$.category')=o.category
      AND json_extract(NEW.operation_snapshot_json,'$.workflow_category')=o.workflow_category
      AND json_extract(NEW.operation_snapshot_json,'$.idempotency_key')=o.idempotency_key
      AND json_extract(NEW.operation_snapshot_json,'$.request_fingerprint')=o.request_fingerprint
      AND json_extract(NEW.operation_snapshot_json,'$.status')=o.status
      AND json_type(NEW.operation_snapshot_json,'$.google_file_id') IS NOT NULL
      AND json_extract(NEW.operation_snapshot_json,'$.google_file_id') IS o.google_file_id
      AND json_type(NEW.operation_snapshot_json,'$.error_code') IS NOT NULL
      AND json_extract(NEW.operation_snapshot_json,'$.error_code') IS o.error_code
      AND json_extract(NEW.operation_snapshot_json,'$.created_by')=o.created_by
      AND json_extract(NEW.operation_snapshot_json,'$.created_at')=o.created_at
      AND json_extract(NEW.operation_snapshot_json,'$.updated_at')=o.updated_at
      AND NEW.approved_at>o.updated_at
      AND NOT EXISTS(SELECT 1 FROM preview_google_case_evidence e WHERE e.operation_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM preview_evidence_upload_locks l WHERE l.organization_id=o.organization_id AND l.case_id=o.case_id AND l.category=o.workflow_category)
      AND NOT EXISTS(SELECT 1 FROM preview_google_case_operations n WHERE n.id=NEW.replacement_operation_id)
  );
END;
CREATE TRIGGER IF NOT EXISTS preview_google_case_retry_approval_update_guard
BEFORE UPDATE ON preview_google_case_retry_approvals BEGIN SELECT RAISE(ABORT,'manual retry approvals are append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_google_case_retry_approval_delete_guard
BEFORE DELETE ON preview_google_case_retry_approvals BEGIN SELECT RAISE(ABORT,'manual retry approvals are retained'); END;

-- Replace only the index rule, not rows or terminal-transition guards.
-- A partial index cannot reference the approval table; the trigger below retains the unresolved guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_google_case_operation_pending_fingerprint
ON preview_google_case_operations(organization_id,case_id,category,request_fingerprint) WHERE status='PENDING';
CREATE TRIGGER IF NOT EXISTS preview_google_case_operation_retry_guard
BEFORE INSERT ON preview_google_case_operations BEGIN
  SELECT RAISE(ABORT,'unresolved Google case upload requires its exact manual retry authorization') WHERE EXISTS (
    SELECT 1 FROM preview_google_case_operations o
    WHERE o.organization_id=NEW.organization_id AND o.case_id=NEW.case_id AND o.workflow_category=NEW.workflow_category
      AND o.status='RECONCILIATION_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM preview_google_case_retry_approvals a
        LEFT JOIN preview_google_case_operations n ON n.id=a.replacement_operation_id
        WHERE a.operation_id=o.id AND (
          (a.replacement_operation_id=NEW.id AND n.id IS NULL AND NEW.status='PENDING'
            AND NEW.created_by=a.approved_by AND NEW.request_fingerprint=o.request_fingerprint
            AND NEW.idempotency_key<>o.idempotency_key AND NEW.created_at>=a.approved_at AND NEW.created_at<a.expires_at)
          OR (n.status='SUCCEEDED' AND EXISTS (
            SELECT 1 FROM preview_google_case_evidence e WHERE e.operation_id=n.id
              AND e.case_id=o.case_id AND e.workflow_category=o.workflow_category
              AND e.original_name=a.original_name AND e.mime_type=a.mime_type AND e.byte_size=a.byte_size AND e.sha256=a.sha256
          ))
        )
      )
  );
  SELECT RAISE(ABORT,'manual retry replacement must preserve scope and fingerprint') WHERE EXISTS (
    SELECT 1 FROM preview_google_case_retry_approvals a JOIN preview_google_case_operations o ON o.id=a.operation_id
    WHERE a.replacement_operation_id=NEW.id AND (
      NEW.status<>'PENDING' OR NEW.organization_id<>o.organization_id OR NEW.case_id<>o.case_id
      OR NEW.category<>o.category OR NEW.workflow_category<>o.workflow_category OR NEW.request_fingerprint<>o.request_fingerprint
      OR NEW.created_by<>a.approved_by OR NEW.idempotency_key=o.idempotency_key
      OR NEW.created_at<a.approved_at OR NEW.created_at>=a.expires_at
    )
  );
END;
CREATE TRIGGER IF NOT EXISTS preview_google_case_retry_evidence_guard
BEFORE INSERT ON preview_google_case_evidence BEGIN
  SELECT RAISE(ABORT,'manual retry evidence must match approved bytes') WHERE EXISTS (
    SELECT 1 FROM preview_google_case_retry_approvals a WHERE a.replacement_operation_id=NEW.operation_id
      AND (NEW.original_name<>a.original_name OR NEW.mime_type<>a.mime_type OR NEW.byte_size<>a.byte_size OR NEW.sha256<>a.sha256)
  );
END;
DROP INDEX IF EXISTS idx_preview_google_case_operation_active_fingerprint;

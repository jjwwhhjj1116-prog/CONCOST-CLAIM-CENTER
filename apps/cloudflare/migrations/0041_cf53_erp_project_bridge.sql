-- CF53: Durable, retryable ERP project-registration outbox.

CREATE TABLE IF NOT EXISTS preview_erp_project_syncs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL UNIQUE,
  proposal_link_id TEXT NOT NULL,
  event_kind TEXT NOT NULL DEFAULT 'PROJECT_AWARDED',
  status TEXT NOT NULL DEFAULT 'PENDING',
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  erp_project_id TEXT,
  last_error_code TEXT,
  last_attempt_at TEXT,
  synced_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (event_kind = 'PROJECT_AWARDED'),
  CHECK (status IN ('PENDING','SYNCED','FAILED')),
  CHECK (length(payload_json) BETWEEN 2 AND 200000),
  CHECK (length(payload_sha256) = 64),
  CHECK (attempts >= 0),
  CHECK (status <> 'SYNCED' OR (erp_project_id IS NOT NULL AND synced_at IS NOT NULL)),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (proposal_link_id) REFERENCES preview_proposal_links(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_erp_project_sync_status
ON preview_erp_project_syncs(status, updated_at);

CREATE TRIGGER IF NOT EXISTS preview_erp_project_sync_identity_guard
BEFORE UPDATE ON preview_erp_project_syncs
WHEN NEW.id <> OLD.id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.case_id <> OLD.case_id
  OR NEW.proposal_link_id <> OLD.proposal_link_id
  OR NEW.event_kind <> OLD.event_kind
  OR NEW.payload_json <> OLD.payload_json
  OR NEW.payload_sha256 <> OLD.payload_sha256
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'ERP project sync identity and payload are immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_erp_project_sync_delete_guard
BEFORE DELETE ON preview_erp_project_syncs
BEGIN
  SELECT RAISE(ABORT, 'ERP project sync audit records cannot be deleted');
END;

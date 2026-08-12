-- CF05: Google Drive direct evidence storage. R2 is intentionally not used.

CREATE TABLE IF NOT EXISTS preview_google_credentials (
  organization_id TEXT PRIMARY KEY NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (length(encrypted_refresh_token) >= 32),
  CHECK (length(iv) = 24),
  CHECK (scope = 'https://www.googleapis.com/auth/drive.file'),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_google_pkce (
  state_hash TEXT PRIMARY KEY NOT NULL,
  encrypted_code_verifier TEXT NOT NULL,
  iv TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (length(state_hash) = 64),
  CHECK (length(encrypted_code_verifier) >= 32),
  CHECK (length(iv) = 24),
  CHECK (redirect_uri LIKE 'https://%/api/google/oauth/callback'),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_google_case_folders (
  draft_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  google_folder_id TEXT NOT NULL,
  bound_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(draft_id) = 64),
  CHECK (organization_id = 'concost'),
  CHECK (length(google_folder_id) BETWEEN 10 AND 200),
  FOREIGN KEY (draft_id) REFERENCES preview_drafts(id),
  FOREIGN KEY (bound_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_google_operations (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  google_file_id TEXT,
  error_code TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (draft_id, idempotency_key),
  CHECK (length(id) = 36),
  CHECK (length(draft_id) = 64),
  CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED')),
  FOREIGN KEY (draft_id) REFERENCES preview_drafts(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

ALTER TABLE preview_evidence RENAME TO preview_evidence_cf03;

CREATE TABLE preview_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  drive_status TEXT NOT NULL,
  sha256 TEXT,
  google_file_id TEXT,
  google_folder_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'PENDING_GOOGLE_CONNECTION',
  reconciliation_status TEXT NOT NULL DEFAULT 'CLEAN',
  idempotency_key TEXT,
  CHECK (length(id) = 36),
  CHECK (length(draft_id) = 64),
  CHECK (length(original_name) BETWEEN 1 AND 240),
  CHECK (byte_size BETWEEN 1 AND 10000000),
  CHECK (length(uploaded_by) BETWEEN 1 AND 100),
  CHECK (storage_provider IN ('CLOUDFLARE_R2', 'GOOGLE_DRIVE')),
  CHECK (drive_status IN ('PENDING_GOOGLE_CONNECTION', 'SYNCED_TO_GOOGLE_DRIVE', 'GOOGLE_SYNC_FAILED')),
  CHECK (sync_status IN ('PENDING_GOOGLE_CONNECTION', 'SYNCED', 'FAILED')),
  CHECK (reconciliation_status IN ('CLEAN', 'RECONCILIATION_REQUIRED'))
);

INSERT INTO preview_evidence (
  id, draft_id, object_key, original_name, mime_type, byte_size, uploaded_at,
  uploaded_by, storage_provider, drive_status, sync_status, reconciliation_status
)
SELECT
  id, draft_id, object_key, original_name, mime_type, byte_size, uploaded_at,
  uploaded_by, storage_provider, drive_status, 'PENDING_GOOGLE_CONNECTION', 'CLEAN'
FROM preview_evidence_cf03;

DROP TABLE preview_evidence_cf03;

CREATE INDEX IF NOT EXISTS idx_preview_evidence_draft_uploaded
  ON preview_evidence(draft_id, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_evidence_idempotency
  ON preview_evidence(draft_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_evidence_google_file
  ON preview_evidence(google_file_id)
  WHERE google_file_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_google_operation_active_fingerprint
  ON preview_google_operations(draft_id, request_fingerprint)
  WHERE status <> 'FAILED';

CREATE TRIGGER IF NOT EXISTS cf05_google_operation_insert_guard
BEFORE INSERT ON preview_google_operations
WHEN NEW.status <> 'PENDING' OR NEW.google_file_id IS NOT NULL OR NEW.error_code IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'CF05 Google operation must start pending');
END;

CREATE TRIGGER IF NOT EXISTS cf05_google_operation_update_guard
BEFORE UPDATE ON preview_google_operations
WHEN OLD.status <> 'PENDING'
  OR NEW.id <> OLD.id
  OR NEW.draft_id <> OLD.draft_id
  OR NEW.idempotency_key <> OLD.idempotency_key
  OR NEW.request_fingerprint <> OLD.request_fingerprint
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
  OR NEW.status NOT IN ('SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED')
  OR (NEW.status = 'SUCCEEDED' AND NEW.google_file_id IS NULL)
  OR (NEW.status <> 'SUCCEEDED' AND NEW.error_code IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'CF05 Google operation transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS cf05_google_evidence_insert_guard
BEFORE INSERT ON preview_evidence
WHEN NEW.storage_provider = 'GOOGLE_DRIVE'
  AND (
    NEW.google_file_id IS NULL OR NEW.google_folder_id IS NULL
    OR NEW.sha256 IS NULL OR length(NEW.sha256) <> 64
    OR NEW.sync_status <> 'SYNCED'
    OR NEW.drive_status <> 'SYNCED_TO_GOOGLE_DRIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'CF05 Google evidence metadata is incomplete');
END;

CREATE TRIGGER IF NOT EXISTS cf05_google_evidence_operation_guard
BEFORE INSERT ON preview_evidence
WHEN NEW.storage_provider = 'GOOGLE_DRIVE'
  AND NOT EXISTS (
    SELECT 1 FROM preview_google_operations o
    WHERE o.draft_id = NEW.draft_id
      AND o.idempotency_key = NEW.idempotency_key
      AND o.status = 'PENDING'
  )
BEGIN
  SELECT RAISE(ABORT, 'CF05 Google evidence requires a pending operation');
END;

CREATE TRIGGER IF NOT EXISTS cf05_google_evidence_immutable
BEFORE UPDATE ON preview_evidence
WHEN OLD.storage_provider = 'GOOGLE_DRIVE'
BEGIN
  SELECT RAISE(ABORT, 'CF05 Google evidence metadata is immutable');
END;

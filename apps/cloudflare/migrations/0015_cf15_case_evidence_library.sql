-- CF15: project-scoped temporary evidence storage for the Cloudflare preview.
-- File bytes are chunked below D1 row limits and can later be migrated to Google Drive.

CREATE TABLE IF NOT EXISTS preview_case_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  category TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'D1_TEMPORARY',
  uploaded_by_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (category IN ('TAKEOFF_SOURCE','COST_BREAKDOWN')),
  CHECK (length(original_name) BETWEEN 1 AND 240),
  CHECK (length(mime_type) BETWEEN 3 AND 160),
  CHECK (byte_size BETWEEN 1 AND 10000000),
  CHECK (sha256 GLOB '[0-9a-f]*' AND length(sha256) = 64),
  CHECK (chunk_count BETWEEN 1 AND 24),
  CHECK (storage_provider = 'D1_TEMPORARY'),
  CHECK (length(uploaded_by_name) BETWEEN 1 AND 100),
  CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CHECK (request_fingerprint GLOB '[0-9a-f]*' AND length(request_fingerprint) = 64),
  UNIQUE (organization_id, case_id, idempotency_key),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (uploaded_by_id) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_case_evidence_chunks (
  evidence_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (evidence_id, chunk_index),
  CHECK (chunk_index BETWEEN 0 AND 23),
  CHECK (byte_size BETWEEN 1 AND 450000),
  CHECK (length(payload) = byte_size),
  FOREIGN KEY (evidence_id) REFERENCES preview_case_evidence(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_case_evidence_case_uploaded
  ON preview_case_evidence(case_id, uploaded_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_case_evidence_insert_guard
BEFORE INSERT ON preview_case_evidence
BEGIN
  SELECT RAISE(ABORT, 'case evidence requires an active project')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_cases c
    WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id AND c.deleted_at IS NULL
  );
  SELECT RAISE(ABORT, 'case evidence actor is not allowed')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id = NEW.uploaded_by_id AND u.is_active = 1 AND u.display_name = NEW.uploaded_by_name
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff','reviewer'))
      AND (
        EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = 'admin')
        OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = NEW.case_id AND a.user_id = NEW.uploaded_by_id)
      )
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_case_evidence_update_guard
BEFORE UPDATE ON preview_case_evidence
BEGIN
  SELECT RAISE(ABORT, 'case evidence metadata is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_case_evidence_delete_guard
BEFORE DELETE ON preview_case_evidence
BEGIN
  SELECT RAISE(ABORT, 'case evidence metadata is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_case_evidence_chunk_insert_guard
BEFORE INSERT ON preview_case_evidence_chunks
BEGIN
  SELECT RAISE(ABORT, 'case evidence chunk is outside its manifest')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_case_evidence e
    WHERE e.id = NEW.evidence_id AND NEW.chunk_index < e.chunk_count
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_case_evidence_chunk_update_guard
BEFORE UPDATE ON preview_case_evidence_chunks
BEGIN
  SELECT RAISE(ABORT, 'case evidence chunks are append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_case_evidence_chunk_delete_guard
BEFORE DELETE ON preview_case_evidence_chunks
BEGIN
  SELECT RAISE(ABORT, 'case evidence chunks are append-only');
END;

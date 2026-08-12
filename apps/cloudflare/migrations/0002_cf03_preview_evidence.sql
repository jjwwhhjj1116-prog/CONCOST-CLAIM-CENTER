-- CF03: Preview evidence metadata stored in D1; binary objects live in private R2.
CREATE TABLE IF NOT EXISTS preview_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'CLOUDFLARE_R2',
  drive_status TEXT NOT NULL DEFAULT 'PENDING_GOOGLE_CONNECTION',
  CHECK (length(id) = 36),
  CHECK (length(draft_id) = 64),
  CHECK (length(original_name) BETWEEN 1 AND 240),
  CHECK (byte_size BETWEEN 1 AND 10000000),
  CHECK (length(uploaded_by) BETWEEN 1 AND 100),
  CHECK (storage_provider = 'CLOUDFLARE_R2'),
  CHECK (drive_status IN ('PENDING_GOOGLE_CONNECTION', 'SYNCED_TO_GOOGLE_DRIVE', 'GOOGLE_SYNC_FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_preview_evidence_draft_uploaded
  ON preview_evidence(draft_id, uploaded_at DESC);

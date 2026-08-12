-- CF05: Google Drive Evidence Sync & Cloudflare Integration Schema

CREATE TABLE IF NOT EXISTS preview_google_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE,
  encrypted_refresh_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  scope TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preview_google_pkce (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Evidence metadata extension for Google Drive
ALTER TABLE preview_evidence ADD COLUMN sha256 TEXT;
ALTER TABLE preview_evidence ADD COLUMN google_file_id TEXT;
ALTER TABLE preview_evidence ADD COLUMN google_folder_id TEXT;
ALTER TABLE preview_evidence ADD COLUMN sync_status TEXT DEFAULT 'PENDING_GOOGLE_CONNECTION';
ALTER TABLE preview_evidence ADD COLUMN reconciliation_status TEXT DEFAULT 'CLEAN';
ALTER TABLE preview_evidence ADD COLUMN idempotency_key TEXT;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS preview_proposal_company_asset_versions (
  organization_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_data BLOB NOT NULL,
  file_sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, asset_key, version),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_proposal_asset_versions_lookup
  ON preview_proposal_company_asset_versions (organization_id, asset_key, version DESC);

INSERT OR IGNORE INTO preview_proposal_company_asset_versions
  (organization_id, asset_key, version, mime_type, file_name, file_data, file_sha256, width, height, created_by, created_at)
SELECT organization_id, asset_key, version, mime_type, file_name, file_data, file_sha256, width, height, updated_by,
       COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM preview_proposal_company_assets
WHERE file_data IS NOT NULL
  AND mime_type IS NOT NULL
  AND file_name IS NOT NULL
  AND file_sha256 IS NOT NULL;

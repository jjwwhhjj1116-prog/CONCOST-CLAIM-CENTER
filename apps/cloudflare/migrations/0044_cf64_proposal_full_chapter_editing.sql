PRAGMA foreign_keys = ON;

-- Project-specific proposal images are append-only source assets. Removing an image
-- from a chapter only removes its inline reference from the next proposal version;
-- the original byte stream remains available for audit and older versions.
CREATE TABLE IF NOT EXISTS preview_proposal_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number BETWEEN 1 AND 12),
  display_order INTEGER NOT NULL CHECK (display_order BETWEEN 1 AND 999),
  title TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'image/jpeg'),
  file_name TEXT NOT NULL,
  file_data BLOB NOT NULL,
  file_sha256 TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width BETWEEN 100 AND 6000),
  height INTEGER NOT NULL CHECK (height BETWEEN 100 AND 6000),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES preview_proposals(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_proposal_assets_scope
  ON preview_proposal_assets (proposal_id, chapter_number, display_order);

CREATE TRIGGER IF NOT EXISTS preview_proposal_asset_scope_guard
BEFORE INSERT ON preview_proposal_assets
WHEN NOT EXISTS (
  SELECT 1 FROM preview_proposals p
  WHERE p.id = NEW.proposal_id
    AND p.case_id = NEW.case_id
    AND p.organization_id = NEW.organization_id
    AND p.status = 'DRAFT'
)
BEGIN
  SELECT RAISE(ABORT, 'proposal image requires an editable proposal in the same case');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_asset_update_guard
BEFORE UPDATE ON preview_proposal_assets
BEGIN
  SELECT RAISE(ABORT, 'proposal image source is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_asset_delete_guard
BEFORE DELETE ON preview_proposal_assets
BEGIN
  SELECT RAISE(ABORT, 'proposal image source is append-only');
END;

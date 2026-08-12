-- CF07: Case-scoped report autosave and append-only revision history.

CREATE TABLE IF NOT EXISTS preview_report_drafts (
  case_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (length(title) BETWEEN 1 AND 300),
  CHECK (length(content) <= 500000),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (version >= 1),
  CHECK (length(title) BETWEEN 1 AND 300),
  CHECK (length(content) <= 500000),
  CHECK (length(content_sha256) = 64),
  UNIQUE (case_id, version),
  FOREIGN KEY (case_id) REFERENCES preview_report_drafts(case_id),
  FOREIGN KEY (saved_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_revisions_case
  ON preview_report_revisions(case_id, version DESC);

CREATE TRIGGER IF NOT EXISTS preview_report_draft_identity_immutable
BEFORE UPDATE ON preview_report_drafts
WHEN NEW.case_id <> OLD.case_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'preview report draft identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_draft_version_guard
BEFORE UPDATE ON preview_report_drafts
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'preview report draft optimistic version is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_draft_delete_guard
BEFORE DELETE ON preview_report_drafts
BEGIN
  SELECT RAISE(ABORT, 'preview report drafts cannot be physically deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_revision_update_guard
BEFORE UPDATE ON preview_report_revisions
BEGIN
  SELECT RAISE(ABORT, 'preview report revisions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_revision_delete_guard
BEFORE DELETE ON preview_report_revisions
BEGIN
  SELECT RAISE(ABORT, 'preview report revisions are append-only');
END;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS preview_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_name_snapshot TEXT NOT NULL,
  template_body_snapshot TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED')),
  current_version_id TEXT,
  approved_version_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_proposal_versions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  body_text TEXT NOT NULL,
  structured_inputs_json TEXT NOT NULL CHECK (json_valid(structured_inputs_json)),
  generation_mode TEXT NOT NULL CHECK (generation_mode IN ('MANUAL','AI')),
  provider_id TEXT,
  model_id TEXT,
  input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
  source_document_version_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_document_version_ids_json)),
  missing_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(missing_fields_json)),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK (is_approved IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES preview_proposals(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id),
  UNIQUE (proposal_id, version_number)
);

CREATE TABLE IF NOT EXISTS preview_proposal_reviews (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('REQUEST_REVIEW','APPROVE','REJECT')),
  comment TEXT,
  reviewer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES preview_proposals(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (version_id) REFERENCES preview_proposal_versions(id),
  FOREIGN KEY (reviewer_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_proposals_case ON preview_proposals(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_proposal_versions_proposal ON preview_proposal_versions(proposal_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_preview_proposal_reviews_proposal ON preview_proposal_reviews(proposal_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_proposal_insert_guard
BEFORE INSERT ON preview_proposals
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND u.is_active=1
    AND (instr(u.roles_json,'"admin"')>0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=u.id))
)
BEGIN
  SELECT RAISE(ABORT,'proposal author scope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_update_identity_guard
BEFORE UPDATE ON preview_proposals
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.case_id<>OLD.case_id
  OR NEW.template_id<>OLD.template_id OR NEW.template_name_snapshot<>OLD.template_name_snapshot
  OR NEW.template_body_snapshot<>OLD.template_body_snapshot OR NEW.title<>OLD.title
  OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'proposal identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_update_version_guard
BEFORE UPDATE ON preview_proposals
WHEN NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'proposal optimistic version is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_update_status_guard
BEFORE UPDATE ON preview_proposals
WHEN NOT ((OLD.status='DRAFT' AND (NEW.status='DRAFT' OR NEW.status='IN_REVIEW'))
  OR (OLD.status='IN_REVIEW' AND (NEW.status='APPROVED' OR NEW.status='REJECTED')))
BEGIN
  SELECT RAISE(ABORT,'proposal status transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_delete_guard BEFORE DELETE ON preview_proposals BEGIN SELECT RAISE(ABORT,'proposal cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS preview_proposal_version_update_guard BEFORE UPDATE ON preview_proposal_versions BEGIN SELECT RAISE(ABORT,'proposal version is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_proposal_version_delete_guard BEFORE DELETE ON preview_proposal_versions BEGIN SELECT RAISE(ABORT,'proposal version is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_proposal_review_update_guard BEFORE UPDATE ON preview_proposal_reviews BEGIN SELECT RAISE(ABORT,'proposal review is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_proposal_review_delete_guard BEFORE DELETE ON preview_proposal_reviews BEGIN SELECT RAISE(ABORT,'proposal review is append-only'); END;

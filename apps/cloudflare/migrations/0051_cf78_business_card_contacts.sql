PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS preview_business_card_analyses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10000000),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  gemini_model_code TEXT NOT NULL,
  gemini_credential_source TEXT NOT NULL CHECK (gemini_credential_source IN ('PERSONAL','ORGANIZATION','ENVIRONMENT')),
  extracted_json TEXT NOT NULL CHECK (json_valid(extracted_json)),
  created_by TEXT NOT NULL REFERENCES preview_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_preview_business_card_analyses_actor
  ON preview_business_card_analyses (created_by, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS preview_business_card_operations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  card_id TEXT,
  google_file_id TEXT,
  error_code TEXT,
  created_by TEXT NOT NULL REFERENCES preview_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_preview_business_card_operations_status
  ON preview_business_card_operations (organization_id, status, updated_at);

CREATE TABLE IF NOT EXISTS preview_business_cards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  analysis_id TEXT NOT NULL UNIQUE REFERENCES preview_business_card_analyses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  company TEXT,
  department TEXT,
  title TEXT,
  mobile TEXT,
  phone TEXT,
  fax TEXT,
  email TEXT,
  address TEXT,
  website TEXT,
  notes TEXT,
  tags_text TEXT,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10000000),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  google_file_id TEXT NOT NULL,
  google_folder_id TEXT NOT NULL,
  google_drive_url TEXT NOT NULL,
  gemini_model_code TEXT NOT NULL,
  gemini_credential_source TEXT NOT NULL CHECK (gemini_credential_source IN ('PERSONAL','ORGANIZATION','ENVIRONMENT')),
  extracted_json TEXT NOT NULL CHECK (json_valid(extracted_json)),
  review_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (review_confirmed = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL REFERENCES preview_users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES preview_users(id) ON DELETE RESTRICT,
  deleted_by TEXT REFERENCES preview_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((deleted_at IS NULL AND deleted_by IS NULL) OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_preview_business_cards_search
  ON preview_business_cards (organization_id, deleted_at, name, company, department);
CREATE INDEX IF NOT EXISTS idx_preview_business_cards_creator
  ON preview_business_cards (created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_preview_business_cards_sha
  ON preview_business_cards (organization_id, source_sha256, deleted_at);

CREATE TABLE IF NOT EXISTS preview_business_card_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES preview_business_cards(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('REGISTERED','UPDATED','ADMIN_ARCHIVED','ADMIN_RESTORED')),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  actor_id TEXT NOT NULL REFERENCES preview_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preview_business_card_events_card
  ON preview_business_card_events (card_id, created_at DESC);

DROP TRIGGER IF EXISTS preview_business_cards_insert_guard;
CREATE TRIGGER preview_business_cards_insert_guard
BEFORE INSERT ON preview_business_cards
WHEN NEW.organization_id <> 'concost'
    OR length(trim(NEW.name)) = 0
    OR length(trim(NEW.google_file_id)) < 10
    OR length(trim(NEW.google_folder_id)) < 10
    OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id = NEW.created_by AND u.is_active = 1)
    OR NEW.created_by <> NEW.updated_by
    OR NOT EXISTS (
      SELECT 1 FROM preview_business_card_analyses a
      WHERE a.id = NEW.analysis_id AND a.organization_id = NEW.organization_id
        AND a.created_by = NEW.created_by AND a.source_sha256 = NEW.source_sha256
        AND a.consumed_at IS NULL
    )
BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_INSERT_FORBIDDEN'); END;

DROP TRIGGER IF EXISTS preview_business_cards_update_guard;
CREATE TRIGGER preview_business_cards_update_guard
BEFORE UPDATE ON preview_business_cards
WHEN NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.analysis_id <> OLD.analysis_id
    OR NEW.original_name <> OLD.original_name
    OR NEW.mime_type <> OLD.mime_type
    OR NEW.byte_size <> OLD.byte_size
    OR NEW.source_sha256 <> OLD.source_sha256
    OR NEW.google_file_id <> OLD.google_file_id
    OR NEW.google_folder_id <> OLD.google_folder_id
    OR NEW.google_drive_url <> OLD.google_drive_url
    OR NEW.gemini_model_code <> OLD.gemini_model_code
    OR NEW.gemini_credential_source <> OLD.gemini_credential_source
    OR NEW.extracted_json <> OLD.extracted_json
    OR NEW.review_confirmed <> OLD.review_confirmed
    OR NEW.created_by <> OLD.created_by
    OR NEW.created_at <> OLD.created_at
    OR NEW.version <> OLD.version + 1
    OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id = NEW.updated_by AND u.is_active = 1)
BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_UPDATE_FORBIDDEN'); END;

DROP TRIGGER IF EXISTS preview_business_cards_admin_update_guard;
CREATE TRIGGER preview_business_cards_admin_update_guard
BEFORE UPDATE ON preview_business_cards
WHEN (NEW.deleted_at IS NOT OLD.deleted_at OR NEW.deleted_by IS NOT OLD.deleted_by)
  AND NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id = NEW.updated_by AND u.is_active = 1
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) = 'admin')
  )
BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_ADMIN_REQUIRED'); END;

DROP TRIGGER IF EXISTS preview_business_cards_delete_guard;
CREATE TRIGGER preview_business_cards_delete_guard
BEFORE DELETE ON preview_business_cards
BEGIN
  SELECT RAISE(ABORT, 'BUSINESS_CARD_PHYSICAL_DELETE_FORBIDDEN');
END;

DROP TRIGGER IF EXISTS preview_business_card_events_update_guard;
CREATE TRIGGER preview_business_card_events_update_guard
BEFORE UPDATE ON preview_business_card_events
BEGIN
  SELECT RAISE(ABORT, 'BUSINESS_CARD_EVENT_IMMUTABLE');
END;

DROP TRIGGER IF EXISTS preview_business_card_events_delete_guard;
CREATE TRIGGER preview_business_card_events_delete_guard
BEFORE DELETE ON preview_business_card_events
BEGIN
  SELECT RAISE(ABORT, 'BUSINESS_CARD_EVENT_IMMUTABLE');
END;

-- Every active operational member shares and may complete the inquiry-to-
-- reception workflow. Optimistic versions, immutable decisions, and audit
-- events remain mandatory; project execution stays assignment-scoped.
DROP TRIGGER IF EXISTS preview_proposal_insert_guard;
CREATE TRIGGER preview_proposal_insert_guard
BEFORE INSERT ON preview_proposals
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id
    AND c.deleted_at IS NULL AND u.is_active=1
    AND c.status IN ('INQUIRY','PROPOSAL','ESTIMATE')
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm','staff','reviewer'))
)
BEGIN SELECT RAISE(ABORT,'proposal author scope is invalid'); END;

DROP TRIGGER IF EXISTS preview_proposal_link_insert_guard;
CREATE TRIGGER preview_proposal_link_insert_guard
BEFORE INSERT ON preview_proposal_links
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by AND u.is_active=1
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id
    AND c.deleted_at IS NULL AND c.status IN ('INQUIRY','PROPOSAL','ESTIMATE')
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm','staff','reviewer'))
)
BEGIN SELECT RAISE(ABORT, 'proposal link actor or case scope is invalid'); END;

DROP TRIGGER IF EXISTS preview_award_decision_insert_guard;
CREATE TRIGGER preview_award_decision_insert_guard
BEFORE INSERT ON preview_award_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM preview_proposal_links p
  JOIN preview_cases c ON c.id=p.case_id AND c.organization_id=p.organization_id AND c.deleted_at IS NULL
  JOIN preview_users u ON u.id=NEW.decided_by AND u.is_active=1
  WHERE p.id=NEW.proposal_link_id AND p.case_id=NEW.case_id
    AND p.award_status='PENDING' AND p.version=NEW.expected_link_version
    AND c.status IN ('INQUIRY','PROPOSAL','ESTIMATE')
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm','staff','reviewer'))
)
BEGIN SELECT RAISE(ABORT, 'award decision actor, case, or version is invalid'); END;

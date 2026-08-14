-- CF14: Link sent proposal snapshots and record an independent award decision.

CREATE TABLE IF NOT EXISTS preview_proposal_links (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  proposal_number TEXT NOT NULL,
  proposal_title TEXT NOT NULL,
  revision_label TEXT NOT NULL,
  client_name TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  response_due_on TEXT,
  proposed_amount_krw INTEGER,
  document_url TEXT,
  document_sha256 TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  award_status TEXT NOT NULL DEFAULT 'PENDING',
  award_decided_at TEXT,
  award_decided_by TEXT,
  contract_amount_krw INTEGER,
  project_start_on TEXT,
  project_end_on TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (length(proposal_number) BETWEEN 2 AND 100),
  CHECK (length(proposal_title) BETWEEN 1 AND 500),
  CHECK (length(revision_label) BETWEEN 1 AND 80),
  CHECK (length(client_name) BETWEEN 1 AND 300),
  CHECK (proposed_amount_krw IS NULL OR proposed_amount_krw BETWEEN 0 AND 100000000000000),
  CHECK (document_sha256 IS NULL OR length(document_sha256) = 64),
  CHECK (verification_status IN ('UNVERIFIED','VERIFIED','CONFLICT')),
  CHECK (award_status IN ('PENDING','WON','LOST')),
  CHECK (version >= 1),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK (
    verification_status <> 'VERIFIED'
    OR (document_url IS NOT NULL AND document_sha256 IS NOT NULL)
  ),
  CHECK (
    award_status = 'PENDING'
    OR (award_decided_at IS NOT NULL AND award_decided_by IS NOT NULL)
  ),
  CHECK (
    award_status <> 'WON'
    OR (contract_amount_krw IS NOT NULL AND contract_amount_krw > 0 AND project_start_on IS NOT NULL AND project_end_on IS NOT NULL AND project_end_on >= project_start_on)
  ),
  CHECK (
    award_status <> 'LOST'
    OR (contract_amount_krw IS NULL AND project_start_on IS NULL AND project_end_on IS NULL)
  ),
  UNIQUE (organization_id, case_id, proposal_number, revision_label),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (award_decided_by) REFERENCES preview_users(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_award_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_link_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_note TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  contract_amount_krw INTEGER,
  project_start_on TEXT,
  project_end_on TEXT,
  expected_link_version INTEGER NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (decision IN ('WON','LOST')),
  CHECK (length(decision_note) BETWEEN 2 AND 5000),
  CHECK (expected_link_version >= 1),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK (
    decision <> 'WON'
    OR (contract_amount_krw IS NOT NULL AND contract_amount_krw > 0 AND project_start_on IS NOT NULL AND project_end_on IS NOT NULL AND project_end_on >= project_start_on)
  ),
  CHECK (
    decision <> 'LOST'
    OR (contract_amount_krw IS NULL AND project_start_on IS NULL AND project_end_on IS NULL)
  ),
  FOREIGN KEY (proposal_link_id) REFERENCES preview_proposal_links(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (decided_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_proposal_links_case ON preview_proposal_links(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_proposal_links_award ON preview_proposal_links(award_status, response_due_on, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_award_decisions_link ON preview_award_decisions(proposal_link_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_proposal_link_insert_guard
BEFORE INSERT ON preview_proposal_links
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c
  JOIN preview_users u ON u.id = NEW.created_by AND u.is_active = 1
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id AND c.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm'))
    AND (
      EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) = 'admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = c.id AND a.user_id = u.id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'proposal link actor or case scope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_link_identity_guard
BEFORE UPDATE ON preview_proposal_links
WHEN NEW.id <> OLD.id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.case_id <> OLD.case_id
  OR NEW.proposal_number <> OLD.proposal_number
  OR NEW.proposal_title <> OLD.proposal_title
  OR NEW.revision_label <> OLD.revision_label
  OR NEW.client_name <> OLD.client_name
  OR NEW.sent_at <> OLD.sent_at
  OR COALESCE(NEW.response_due_on,'') <> COALESCE(OLD.response_due_on,'')
  OR COALESCE(NEW.proposed_amount_krw,-1) <> COALESCE(OLD.proposed_amount_krw,-1)
  OR COALESCE(NEW.document_url,'') <> COALESCE(OLD.document_url,'')
  OR COALESCE(NEW.document_sha256,'') <> COALESCE(OLD.document_sha256,'')
  OR NEW.verification_status <> OLD.verification_status
  OR NEW.request_key <> OLD.request_key
  OR NEW.request_fingerprint <> OLD.request_fingerprint
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'proposal link snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_link_award_guard
BEFORE UPDATE ON preview_proposal_links
WHEN OLD.award_status <> 'PENDING'
  OR NEW.award_status NOT IN ('WON','LOST')
  OR NEW.version <> OLD.version + 1
  OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_award_decisions d
    WHERE d.proposal_link_id = OLD.id
      AND d.case_id = OLD.case_id
      AND d.decision = NEW.award_status
      AND d.expected_link_version = OLD.version
      AND d.decided_by = NEW.award_decided_by
      AND d.decided_at = NEW.award_decided_at
      AND COALESCE(d.contract_amount_krw,-1) = COALESCE(NEW.contract_amount_krw,-1)
      AND COALESCE(d.project_start_on,'') = COALESCE(NEW.project_start_on,'')
      AND COALESCE(d.project_end_on,'') = COALESCE(NEW.project_end_on,'')
  )
BEGIN
  SELECT RAISE(ABORT, 'proposal award transition is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_link_delete_guard
BEFORE DELETE ON preview_proposal_links
BEGIN
  SELECT RAISE(ABORT, 'proposal links cannot be physically deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_award_decision_insert_guard
BEFORE INSERT ON preview_award_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM preview_proposal_links p
  JOIN preview_cases c ON c.id = p.case_id AND c.organization_id = p.organization_id AND c.deleted_at IS NULL
  JOIN preview_users u ON u.id = NEW.decided_by AND u.is_active = 1
  WHERE p.id = NEW.proposal_link_id AND p.case_id = NEW.case_id
    AND p.award_status = 'PENDING' AND p.version = NEW.expected_link_version
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm'))
    AND (
      EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) = 'admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = c.id AND a.user_id = u.id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'award decision actor, case, or version is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_award_decision_update_guard
BEFORE UPDATE ON preview_award_decisions
BEGIN
  SELECT RAISE(ABORT, 'award decisions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_award_decision_delete_guard
BEFORE DELETE ON preview_award_decisions
BEGIN
  SELECT RAISE(ABORT, 'award decisions are append-only');
END;

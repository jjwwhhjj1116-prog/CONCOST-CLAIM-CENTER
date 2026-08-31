-- CF72: reversible award corrections and member registration requests.
-- Existing award decisions and users remain immutable/preserved.

CREATE TABLE IF NOT EXISTS preview_award_effective_states (
  proposal_link_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  effective_status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (effective_status IN ('WON','LOST')),
  CHECK (version >= 1),
  FOREIGN KEY (proposal_link_id) REFERENCES preview_proposal_links(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

INSERT OR IGNORE INTO preview_award_effective_states
  (proposal_link_id,case_id,effective_status,version,updated_by,updated_at)
SELECT id,case_id,award_status,1,award_decided_by,award_decided_at
FROM preview_proposal_links
WHERE award_status IN ('WON','LOST') AND award_decided_by IS NOT NULL AND award_decided_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS preview_award_adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_link_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  expected_state_version INTEGER NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  adjusted_by TEXT NOT NULL,
  adjusted_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (previous_status IN ('WON','LOST')),
  CHECK (next_status IN ('WON','LOST')),
  CHECK (previous_status <> next_status),
  CHECK (length(reason) BETWEEN 2 AND 3000),
  CHECK (expected_state_version >= 1),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  FOREIGN KEY (proposal_link_id) REFERENCES preview_proposal_links(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (adjusted_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_award_effective_case
  ON preview_award_effective_states(case_id,effective_status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_award_adjustments_link
  ON preview_award_adjustments(proposal_link_id,adjusted_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_award_adjustment_update_guard
BEFORE UPDATE ON preview_award_adjustments
BEGIN
  SELECT RAISE(ABORT, 'award adjustments are append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_award_adjustment_delete_guard
BEFORE DELETE ON preview_award_adjustments
BEGIN
  SELECT RAISE(ABORT, 'award adjustments are append-only');
END;

CREATE TABLE IF NOT EXISTS preview_user_registration_requests (
  id TEXT PRIMARY KEY NOT NULL,
  login_id TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  requested_role TEXT NOT NULL DEFAULT 'staff',
  request_note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(login_id) BETWEEN 3 AND 100),
  CHECK (length(display_name) BETWEEN 1 AND 100),
  CHECK (length(email) BETWEEN 3 AND 200),
  CHECK (length(password_salt) = 32),
  CHECK (length(password_hash) = 64),
  CHECK (password_iterations BETWEEN 100000 AND 600000),
  CHECK (requested_role IN ('staff','reviewer','pm')),
  CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  CHECK (version >= 1),
  FOREIGN KEY (reviewed_by) REFERENCES preview_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_registration_pending_login
  ON preview_user_registration_requests(login_id) WHERE status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_registration_pending_email
  ON preview_user_registration_requests(email) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS idx_preview_registration_status
  ON preview_user_registration_requests(status,created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_registration_delete_guard
BEFORE DELETE ON preview_user_registration_requests
BEGIN
  SELECT RAISE(ABORT, 'registration requests cannot be physically deleted');
END;

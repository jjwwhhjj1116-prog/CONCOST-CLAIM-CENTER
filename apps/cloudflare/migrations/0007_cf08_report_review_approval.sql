-- CF08: Immutable report review requests and independent approval decisions.

CREATE TABLE IF NOT EXISTS preview_report_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  report_revision_id TEXT NOT NULL,
  report_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by TEXT NOT NULL,
  request_note TEXT,
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  reviewed_by TEXT,
  decision_note TEXT,
  reviewed_at TEXT,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (report_version >= 1),
  CHECK (status IN ('PENDING','APPROVED','CHANGES_REQUESTED')),
  CHECK (request_note IS NULL OR length(request_note) <= 2000),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK (decision_note IS NULL OR length(decision_note) <= 4000),
  CHECK (
    (status = 'PENDING' AND reviewed_by IS NULL AND decision_note IS NULL AND reviewed_at IS NULL)
    OR
    (status = 'APPROVED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR
    (status = 'CHANGES_REQUESTED' AND reviewed_by IS NOT NULL AND decision_note IS NOT NULL AND length(trim(decision_note)) > 0 AND reviewed_at IS NOT NULL)
  ),
  UNIQUE (organization_id, request_key),
  UNIQUE (case_id, report_version),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (report_revision_id) REFERENCES preview_report_revisions(id),
  FOREIGN KEY (requested_by) REFERENCES preview_users(id),
  FOREIGN KEY (reviewed_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_review_events (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (event_type IN ('REVIEW_REQUESTED','REPORT_APPROVED','CHANGES_REQUESTED')),
  CHECK (note IS NULL OR length(note) <= 4000),
  UNIQUE (review_id, event_type),
  FOREIGN KEY (review_id) REFERENCES preview_report_reviews(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_reviews_queue
  ON preview_report_reviews(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_report_reviews_case
  ON preview_report_reviews(case_id, report_version DESC);
CREATE INDEX IF NOT EXISTS idx_preview_report_review_events_review
  ON preview_report_review_events(review_id, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_report_reviews_one_pending_case
  ON preview_report_reviews(case_id) WHERE status = 'PENDING';

CREATE TRIGGER IF NOT EXISTS preview_report_review_insert_guard
BEFORE INSERT ON preview_report_reviews
WHEN NEW.status <> 'PENDING'
  OR NEW.reviewed_by IS NOT NULL
  OR NEW.decision_note IS NOT NULL
  OR NEW.reviewed_at IS NOT NULL
  OR NOT EXISTS (
  SELECT 1 FROM preview_report_revisions r
  JOIN preview_cases c ON c.id = r.case_id
  JOIN preview_users u ON u.id = NEW.requested_by
  WHERE r.id = NEW.report_revision_id
    AND r.case_id = NEW.case_id
    AND r.version = NEW.report_version
    AND c.organization_id = NEW.organization_id
    AND u.is_active = 1
    AND (instr(u.roles_json, '"admin"') > 0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = NEW.case_id AND a.user_id = NEW.requested_by))
    AND (instr(u.roles_json, '"admin"') > 0 OR instr(u.roles_json, '"ceo"') > 0 OR instr(u.roles_json, '"director"') > 0 OR instr(u.roles_json, '"pm"') > 0 OR instr(u.roles_json, '"staff"') > 0)
)
BEGIN
  SELECT RAISE(ABORT, 'report review source scope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_review_identity_guard
BEFORE UPDATE ON preview_report_reviews
WHEN NEW.id <> OLD.id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.case_id <> OLD.case_id
  OR NEW.report_revision_id <> OLD.report_revision_id
  OR NEW.report_version <> OLD.report_version
  OR NEW.requested_by <> OLD.requested_by
  OR COALESCE(NEW.request_note, '') <> COALESCE(OLD.request_note, '')
  OR NEW.request_key <> OLD.request_key
  OR NEW.request_fingerprint <> OLD.request_fingerprint
  OR NEW.requested_at <> OLD.requested_at
BEGIN
  SELECT RAISE(ABORT, 'report review request identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_review_decision_guard
BEFORE UPDATE ON preview_report_reviews
WHEN OLD.status <> 'PENDING'
  OR NEW.status NOT IN ('APPROVED','CHANGES_REQUESTED')
  OR NEW.reviewed_by IS NULL
  OR NEW.reviewed_by = OLD.requested_by
  OR NEW.reviewed_at IS NULL
  OR NEW.reviewed_at <= OLD.requested_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id = NEW.reviewed_by
      AND u.is_active = 1
      AND (instr(u.roles_json, '"admin"') > 0 OR instr(u.roles_json, '"ceo"') > 0 OR instr(u.roles_json, '"director"') > 0 OR instr(u.roles_json, '"reviewer"') > 0)
      AND (instr(u.roles_json, '"admin"') > 0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = OLD.case_id AND a.user_id = NEW.reviewed_by))
  )
  OR (NEW.status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM preview_report_drafts d WHERE d.case_id = OLD.case_id AND d.version = OLD.report_version))
BEGIN
  SELECT RAISE(ABORT, 'report review decision is invalid or not independent');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_review_delete_guard
BEFORE DELETE ON preview_report_reviews
BEGIN
  SELECT RAISE(ABORT, 'report reviews cannot be physically deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_review_event_update_guard
BEFORE UPDATE ON preview_report_review_events
BEGIN
  SELECT RAISE(ABORT, 'report review events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_review_event_insert_guard
BEFORE INSERT ON preview_report_review_events
WHEN NOT EXISTS (
  SELECT 1 FROM preview_report_reviews v
  WHERE v.id = NEW.review_id
    AND (
      (NEW.event_type = 'REVIEW_REQUESTED' AND NEW.actor_id = v.requested_by)
      OR (NEW.event_type = 'REPORT_APPROVED' AND v.status = 'APPROVED' AND NEW.actor_id = v.reviewed_by)
      OR (NEW.event_type = 'CHANGES_REQUESTED' AND v.status = 'CHANGES_REQUESTED' AND NEW.actor_id = v.reviewed_by)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'report review event actor or state is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_review_event_delete_guard
BEFORE DELETE ON preview_report_review_events
BEGIN
  SELECT RAISE(ABORT, 'report review events are append-only');
END;

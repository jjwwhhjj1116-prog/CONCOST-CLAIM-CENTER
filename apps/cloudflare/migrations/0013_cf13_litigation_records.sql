-- CF13: Court case and litigation-record management for post-delivery operations.

CREATE TABLE IF NOT EXISTS preview_litigation_cases (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  court_name TEXT NOT NULL,
  court_case_number TEXT NOT NULL,
  case_title TEXT NOT NULL,
  division_name TEXT,
  parties_text TEXT NOT NULL,
  filed_on TEXT,
  current_stage TEXT NOT NULL DEFAULT 'FILED',
  next_hearing_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  official_source_url TEXT,
  source_checked_at TEXT,
  source_checked_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  create_request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (length(court_name) BETWEEN 2 AND 200),
  CHECK (length(court_case_number) BETWEEN 4 AND 80),
  CHECK (length(case_title) BETWEEN 1 AND 500),
  CHECK (division_name IS NULL OR length(division_name) <= 200),
  CHECK (length(parties_text) BETWEEN 1 AND 2000),
  CHECK (current_stage IN ('FILED','PLEADING','APPRAISAL','HEARING','JUDGEMENT','APPEAL','CLOSED')),
  CHECK (verification_status IN ('UNVERIFIED','VERIFIED','CONFLICT')),
  CHECK (version >= 1),
  CHECK (length(create_request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK (
    verification_status <> 'VERIFIED'
    OR (official_source_url IS NOT NULL AND source_checked_at IS NOT NULL AND source_checked_by IS NOT NULL)
  ),
  UNIQUE (organization_id, court_name, court_case_number),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (source_checked_by) REFERENCES preview_users(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_litigation_events (
  id TEXT PRIMARY KEY NOT NULL,
  litigation_case_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  detail_text TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  official_source_url TEXT,
  source_sha256 TEXT,
  schedule_id TEXT,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (event_type IN ('FILED','SERVICE','BRIEF','APPRAISAL','HEARING','JUDGEMENT','APPEAL','CORRECTION','OTHER')),
  CHECK (length(title) BETWEEN 1 AND 300),
  CHECK (length(detail_text) BETWEEN 1 AND 5000),
  CHECK (verification_status IN ('UNVERIFIED','VERIFIED','CONFLICT')),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK (source_sha256 IS NULL OR length(source_sha256) = 64),
  CHECK (
    verification_status <> 'VERIFIED'
    OR (official_source_url IS NOT NULL AND source_sha256 IS NOT NULL)
  ),
  FOREIGN KEY (litigation_case_id) REFERENCES preview_litigation_cases(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (schedule_id) REFERENCES preview_case_schedules(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_litigation_cases_project ON preview_litigation_cases(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_litigation_cases_search ON preview_litigation_cases(court_case_number, court_name, current_stage);
CREATE INDEX IF NOT EXISTS idx_preview_litigation_events_timeline ON preview_litigation_events(litigation_case_id, occurred_at DESC, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_litigation_case_scope_insert_guard
BEFORE INSERT ON preview_litigation_cases
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id AND c.deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'litigation record case scope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_litigation_case_identity_guard
BEFORE UPDATE ON preview_litigation_cases
WHEN NEW.id <> OLD.id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.case_id <> OLD.case_id
  OR NEW.create_request_key <> OLD.create_request_key
  OR NEW.request_fingerprint <> OLD.request_fingerprint
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'litigation record identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_litigation_case_version_guard
BEFORE UPDATE ON preview_litigation_cases
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'litigation record optimistic version is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_litigation_case_delete_guard
BEFORE DELETE ON preview_litigation_cases
BEGIN
  SELECT RAISE(ABORT, 'litigation records cannot be physically deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_litigation_event_scope_guard
BEFORE INSERT ON preview_litigation_events
WHEN NOT EXISTS (
  SELECT 1 FROM preview_litigation_cases l
  JOIN preview_cases c ON c.id = l.case_id AND c.organization_id = l.organization_id
  WHERE l.id = NEW.litigation_case_id AND l.case_id = NEW.case_id AND c.deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'litigation event scope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_litigation_event_update_guard
BEFORE UPDATE ON preview_litigation_events
BEGIN
  SELECT RAISE(ABORT, 'litigation event is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_litigation_event_delete_guard
BEFORE DELETE ON preview_litigation_events
BEGIN
  SELECT RAISE(ABORT, 'litigation event is append-only');
END;

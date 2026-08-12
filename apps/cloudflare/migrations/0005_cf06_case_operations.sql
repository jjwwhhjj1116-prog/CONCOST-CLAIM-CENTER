-- CF06: Real Cloudflare D1 case operations and dashboard projection.

CREATE TABLE IF NOT EXISTS preview_case_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL UNIQUE,
  CHECK (length(case_id) = 36)
);

CREATE TABLE IF NOT EXISTS preview_cases (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INQUIRY',
  version INTEGER NOT NULL DEFAULT 1,
  category_major TEXT NOT NULL,
  category_middle TEXT NOT NULL,
  category_minor TEXT NOT NULL,
  created_by TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  request_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (length(case_number) BETWEEN 8 AND 40),
  CHECK (length(title) BETWEEN 1 AND 500),
  CHECK (description IS NULL OR length(description) <= 5000),
  CHECK (claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
  CHECK (status IN ('INQUIRY','PROPOSAL','ESTIMATE','CONTRACT','MATERIAL_RECEIVED','ANALYSIS','REPORT_DRAFTING','SUBMITTED','LITIGATION','JUDGEMENT','SUCCESS_FEE','CLOSED')),
  CHECK (version >= 1),
  CHECK (length(category_major) BETWEEN 1 AND 100),
  CHECK (length(category_middle) BETWEEN 1 AND 100),
  CHECK (length(category_minor) BETWEEN 1 AND 100),
  CHECK ((idempotency_key IS NULL AND request_fingerprint IS NULL) OR (length(idempotency_key) BETWEEN 8 AND 128 AND length(request_fingerprint) = 64)),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_case_assignments (
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (case_id, user_id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (user_id) REFERENCES preview_users(id),
  FOREIGN KEY (assigned_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_case_parties (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'OTHER',
  contact TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (length(role) BETWEEN 1 AND 80),
  CHECK (contact IS NULL OR length(contact) <= 300),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_case_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  location TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(title) BETWEEN 1 AND 300),
  CHECK (type IN ('COURT','CLIENT','INTERNAL')),
  CHECK (location IS NULL OR length(location) <= 300),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_case_activities (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(event_type) BETWEEN 1 AND 80),
  CHECK (length(title) BETWEEN 1 AND 300),
  CHECK (description IS NULL OR length(description) <= 2000),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_cases_updated ON preview_cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_cases_status ON preview_cases(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_case_assignments_user ON preview_case_assignments(user_id, case_id);
CREATE INDEX IF NOT EXISTS idx_preview_case_parties_case ON preview_case_parties(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_preview_case_schedules_case ON preview_case_schedules(case_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_preview_case_activities_case ON preview_case_activities(case_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_cases_identity_immutable
BEFORE UPDATE ON preview_cases
WHEN NEW.id <> OLD.id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.case_number <> OLD.case_number
  OR NEW.created_by <> OLD.created_by
  OR NEW.created_at <> OLD.created_at
  OR COALESCE(NEW.idempotency_key, '') <> COALESCE(OLD.idempotency_key, '')
  OR COALESCE(NEW.request_fingerprint, '') <> COALESCE(OLD.request_fingerprint, '')
BEGIN
  SELECT RAISE(ABORT, 'preview case identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_cases_version_guard
BEFORE UPDATE ON preview_cases
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'preview case optimistic version is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_cases_delete_guard
BEFORE DELETE ON preview_cases
BEGIN
  SELECT RAISE(ABORT, 'preview cases cannot be physically deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_case_activity_update_guard
BEFORE UPDATE ON preview_case_activities
BEGIN
  SELECT RAISE(ABORT, 'preview case activity is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_case_activity_delete_guard
BEFORE DELETE ON preview_case_activities
BEGIN
  SELECT RAISE(ABORT, 'preview case activity is append-only');
END;

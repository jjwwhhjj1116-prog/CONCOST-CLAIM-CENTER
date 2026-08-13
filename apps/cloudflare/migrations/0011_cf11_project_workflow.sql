-- CF11: Project delivery workflow records for kickoff, site survey, and
-- quantity/workforce allocation. Google Drive binary storage remains deferred;
-- only the planned folder path and file-count metadata are persisted here.

CREATE TABLE IF NOT EXISTS preview_workflow_kickoffs (
  case_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  meeting_at TEXT NOT NULL,
  location TEXT,
  agenda TEXT NOT NULL,
  participant_units_json TEXT NOT NULL DEFAULT '[]',
  raw_notes TEXT NOT NULL DEFAULT '',
  summary_text TEXT NOT NULL DEFAULT '',
  timeline_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PLANNED',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (length(agenda) BETWEEN 1 AND 12000),
  CHECK (location IS NULL OR length(location) <= 300),
  CHECK (json_valid(participant_units_json) AND json_type(participant_units_json) = 'array'),
  CHECK (length(raw_notes) <= 50000),
  CHECK (length(summary_text) <= 30000),
  CHECK (json_valid(timeline_json) AND json_type(timeline_json) = 'array'),
  CHECK (status IN ('PLANNED','COMPLETED','DRAFTED','CONFIRMED')),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_site_surveys (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  survey_date TEXT NOT NULL,
  location TEXT,
  scope_text TEXT NOT NULL,
  lead_unit TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  photo_count INTEGER NOT NULL DEFAULT 0,
  audio_count INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_id, survey_date),
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (survey_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (location IS NULL OR length(location) <= 300),
  CHECK (length(scope_text) BETWEEN 1 AND 12000),
  CHECK (length(lead_unit) BETWEEN 1 AND 120),
  CHECK (length(folder_path) BETWEEN 1 AND 600),
  CHECK (photo_count >= 0 AND audio_count >= 0 AND document_count >= 0),
  CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED')),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_workforce_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  unit_key TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  office TEXT NOT NULL,
  scheduling_mode TEXT NOT NULL,
  discipline TEXT NOT NULL,
  scope_text TEXT NOT NULL,
  basis_text TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (case_id, idempotency_key),
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (length(unit_key) BETWEEN 2 AND 120),
  CHECK (length(unit_label) BETWEEN 1 AND 160),
  CHECK (office IN ('CONCOST','VIETQS')),
  CHECK (scheduling_mode IN ('PERSON','TEAM')),
  CHECK (discipline IN ('FINISH','STRUCTURE','CIVIL_LANDSCAPE')),
  CHECK (length(scope_text) BETWEEN 1 AND 12000),
  CHECK (length(basis_text) BETWEEN 1 AND 12000),
  CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (end_date >= start_date),
  CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_workflow_events (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(event_type) BETWEEN 1 AND 80),
  CHECK (length(entity_id) BETWEEN 1 AND 128),
  CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object'),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_site_surveys_case ON preview_site_surveys(case_id, survey_date DESC);
CREATE INDEX IF NOT EXISTS idx_preview_allocations_case ON preview_workforce_allocations(case_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_preview_workflow_events_case ON preview_workflow_events(case_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_workflow_kickoff_scope_insert
BEFORE INSERT ON preview_workflow_kickoffs
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id = NEW.updated_by
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id AND c.organization_id = 'concost' AND u.is_active = 1
)
BEGIN SELECT RAISE(ABORT, 'workflow kickoff scope is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_workflow_kickoff_update_guard
BEFORE UPDATE ON preview_workflow_kickoffs
WHEN NEW.case_id <> OLD.case_id OR NEW.organization_id <> OLD.organization_id OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'workflow kickoff optimistic version is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_site_survey_scope_insert
BEFORE INSERT ON preview_site_surveys
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id = NEW.updated_by
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id AND u.is_active = 1
)
BEGIN SELECT RAISE(ABORT, 'site survey scope is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_site_survey_update_guard
BEFORE UPDATE ON preview_site_surveys
WHEN NEW.id <> OLD.id OR NEW.case_id <> OLD.case_id OR NEW.organization_id <> OLD.organization_id OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'site survey optimistic version is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_allocation_scope_insert
BEFORE INSERT ON preview_workforce_allocations
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id = NEW.created_by
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id AND u.is_active = 1
)
BEGIN SELECT RAISE(ABORT, 'workforce allocation scope is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_kickoff_delete_guard BEFORE DELETE ON preview_workflow_kickoffs
BEGIN SELECT RAISE(ABORT, 'workflow kickoff cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS preview_site_survey_delete_guard BEFORE DELETE ON preview_site_surveys
BEGIN SELECT RAISE(ABORT, 'site survey cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS preview_allocation_update_guard BEFORE UPDATE ON preview_workforce_allocations
BEGIN SELECT RAISE(ABORT, 'workforce allocation is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_allocation_delete_guard BEFORE DELETE ON preview_workforce_allocations
BEGIN SELECT RAISE(ABORT, 'workforce allocation is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_workflow_event_update_guard BEFORE UPDATE ON preview_workflow_events
BEGIN SELECT RAISE(ABORT, 'workflow event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_workflow_event_delete_guard BEFORE DELETE ON preview_workflow_events
BEGIN SELECT RAISE(ABORT, 'workflow event is append-only'); END;

-- Synthetic demo records only. They make the workflow visible immediately and
-- never reference customer data.
INSERT OR IGNORE INTO preview_workflow_kickoffs (
  case_id, organization_id, meeting_at, location, agenda, participant_units_json,
  raw_notes, summary_text, timeline_json, status, version, updated_by, created_at, updated_at
)
SELECT c.id, c.organization_id, strftime('%Y-%m-%dT10:00:00.000Z','now','+1 day'), '클레임센터 회의실',
  '현장조사 범위, 산출 기준, 담당 팀과 보고서 제출 일정을 확정합니다.',
  '["프로젝트 책임자","Finish Internal 1","Structure Horizon 1"]',
  '합성 데모 메모입니다. 현장조사 범위와 수량산출 기준을 확정하고 담당 팀의 일정을 조율합니다.',
  '', '[]', 'PLANNED', 1, c.created_by, c.created_at, c.created_at
FROM preview_cases c WHERE c.id = '40000000-0000-4000-8000-000000000010';


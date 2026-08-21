-- CF40: PM-owned project scheduling, schedule-change approvals, workflow
-- document AI imports, and explicit external-AI data-governance controls.

CREATE TABLE preview_project_schedule_profiles (
  case_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  responsible_pm_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (responsible_pm_id) REFERENCES preview_users(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE preview_project_stage_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  stage_code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  note_text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_id, stage_code),
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (stage_code IN ('KICKOFF','SITE_SURVEY','TAKEOFF_COST','REPORT_WRITING')),
  CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date >= start_date),
  CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','DELAYED')),
  CHECK (length(note_text) <= 5000),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE preview_schedule_change_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  stage_code TEXT NOT NULL,
  proposed_start_date TEXT NOT NULL,
  proposed_end_date TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expected_schedule_version INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_note TEXT,
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (case_id, request_key),
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (stage_code IN ('KICKOFF','SITE_SURVEY','TAKEOFF_COST','REPORT_WRITING')),
  CHECK (proposed_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (proposed_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND proposed_end_date >= proposed_start_date),
  CHECK (length(reason_text) BETWEEN 2 AND 5000),
  CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  CHECK (expected_schedule_version >= 0),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CHECK (length(request_fingerprint) = 64),
  CHECK ((status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (requested_by) REFERENCES preview_users(id),
  FOREIGN KEY (reviewed_by) REFERENCES preview_users(id)
);

CREATE TABLE preview_project_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  change_request_id TEXT,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, change_request_id, notification_type),
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (notification_type IN ('SCHEDULE_CHANGE_REQUESTED','SCHEDULE_CHANGE_APPROVED','SCHEDULE_CHANGE_REJECTED')),
  CHECK (length(title) BETWEEN 2 AND 300),
  CHECK (length(message) BETWEEN 2 AND 3000),
  FOREIGN KEY (user_id) REFERENCES preview_users(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (change_request_id) REFERENCES preview_schedule_change_requests(id)
);

CREATE TABLE preview_workflow_ai_imports (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  workflow_kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL,
  data_class TEXT NOT NULL,
  redaction_count INTEGER NOT NULL DEFAULT 0,
  provider_kind TEXT NOT NULL,
  model_code TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (workflow_kind IN ('KICKOFF','SITE_SURVEY')),
  CHECK (length(original_name) BETWEEN 1 AND 500),
  CHECK (length(mime_type) BETWEEN 3 AND 160),
  CHECK (byte_size BETWEEN 1 AND 10000000),
  CHECK (length(source_sha256) = 64),
  CHECK (data_class IN ('GENERAL','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  CHECK (redaction_count >= 0),
  CHECK (provider_kind = 'GEMINI'),
  CHECK (length(model_code) BETWEEN 2 AND 120),
  CHECK (status IN ('SUCCEEDED','FAILED','BLOCKED_BY_POLICY')),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE preview_ai_data_governance (
  organization_id TEXT PRIMARY KEY NOT NULL DEFAULT 'concost',
  provider_kind TEXT NOT NULL DEFAULT 'GEMINI',
  provider_service_tier TEXT NOT NULL DEFAULT 'UNVERIFIED_OR_FREE',
  confidential_external_ai_enabled INTEGER NOT NULL DEFAULT 0,
  minimize_personal_data INTEGER NOT NULL DEFAULT 1,
  provider_terms_url TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (provider_kind = 'GEMINI'),
  CHECK (provider_service_tier IN ('UNVERIFIED_OR_FREE','PAID_NO_PRODUCT_IMPROVEMENT','VERTEX_AI_ENTERPRISE')),
  CHECK (confidential_external_ai_enabled IN (0,1)),
  CHECK (minimize_personal_data = 1),
  CHECK (length(provider_terms_url) BETWEEN 10 AND 500),
  CHECK (version >= 1),
  CHECK (confidential_external_ai_enabled = 0 OR (provider_service_tier <> 'UNVERIFIED_OR_FREE' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)),
  FOREIGN KEY (acknowledged_by) REFERENCES preview_users(id)
);

INSERT INTO preview_ai_data_governance (
  organization_id,provider_kind,provider_service_tier,confidential_external_ai_enabled,
  minimize_personal_data,provider_terms_url,acknowledged_by,acknowledged_at,version,updated_at
) VALUES (
  'concost','GEMINI','UNVERIFIED_OR_FREE',0,1,
  'https://ai.google.dev/gemini-api/terms',NULL,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

CREATE INDEX idx_preview_stage_schedules_case ON preview_project_stage_schedules(case_id,start_date,end_date);
CREATE INDEX idx_preview_schedule_requests_pm ON preview_schedule_change_requests(case_id,status,requested_at DESC);
CREATE INDEX idx_preview_project_notifications_user ON preview_project_notifications(user_id,read_at,created_at DESC);
CREATE INDEX idx_preview_workflow_ai_imports_case ON preview_workflow_ai_imports(case_id,workflow_kind,created_at DESC);

CREATE TRIGGER preview_schedule_profile_insert_guard BEFORE INSERT ON preview_project_schedule_profiles
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users pm ON pm.id=NEW.responsible_pm_id AND pm.is_active=1
  JOIN preview_users actor ON actor.id=NEW.updated_by AND actor.is_active=1
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM json_each(pm.roles_json) r WHERE lower(r.value) IN ('pm','admin'))
    AND EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=pm.id)
    AND EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm'))
) BEGIN SELECT RAISE(ABORT,'schedule profile scope or PM is invalid'); END;

CREATE TRIGGER preview_schedule_profile_update_guard BEFORE UPDATE ON preview_project_schedule_profiles
WHEN NEW.case_id<>OLD.case_id OR NEW.organization_id<>OLD.organization_id OR NEW.created_at<>OLD.created_at
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users pm JOIN preview_case_assignments a ON a.user_id=pm.id AND a.case_id=NEW.case_id
    WHERE pm.id=NEW.responsible_pm_id AND pm.is_active=1
      AND EXISTS (SELECT 1 FROM json_each(pm.roles_json) r WHERE lower(r.value) IN ('pm','admin'))
  )
BEGIN SELECT RAISE(ABORT,'schedule profile update is invalid'); END;

CREATE TRIGGER preview_stage_schedule_insert_guard BEFORE INSERT ON preview_project_stage_schedules
WHEN NOT EXISTS (
  SELECT 1 FROM preview_project_schedule_profiles p JOIN preview_users u ON u.id=NEW.updated_by AND u.is_active=1
  WHERE p.case_id=NEW.case_id AND p.organization_id=NEW.organization_id
    AND (p.responsible_pm_id=NEW.updated_by OR EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value)='admin'))
) BEGIN SELECT RAISE(ABORT,'only the responsible PM can create a project stage schedule'); END;

CREATE TRIGGER preview_stage_schedule_update_guard BEFORE UPDATE ON preview_project_stage_schedules
WHEN NEW.id<>OLD.id OR NEW.case_id<>OLD.case_id OR NEW.organization_id<>OLD.organization_id OR NEW.stage_code<>OLD.stage_code
  OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_project_schedule_profiles p JOIN preview_users u ON u.id=NEW.updated_by AND u.is_active=1
    WHERE p.case_id=NEW.case_id AND (p.responsible_pm_id=NEW.updated_by OR EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value)='admin'))
  )
BEGIN SELECT RAISE(ABORT,'stage schedule update or PM authority is invalid'); END;

CREATE TRIGGER preview_schedule_request_insert_guard BEFORE INSERT ON preview_schedule_change_requests
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.requested_by AND u.is_active=1
  JOIN preview_case_assignments a ON a.case_id=c.id AND a.user_id=u.id
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
) OR COALESCE((SELECT version FROM preview_project_stage_schedules WHERE case_id=NEW.case_id AND stage_code=NEW.stage_code),0)<>NEW.expected_schedule_version
BEGIN SELECT RAISE(ABORT,'schedule change request scope or version is invalid'); END;

CREATE TRIGGER preview_schedule_request_update_guard BEFORE UPDATE ON preview_schedule_change_requests
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.case_id<>OLD.case_id OR NEW.stage_code<>OLD.stage_code
  OR NEW.proposed_start_date<>OLD.proposed_start_date OR NEW.proposed_end_date<>OLD.proposed_end_date
  OR NEW.reason_text<>OLD.reason_text OR NEW.expected_schedule_version<>OLD.expected_schedule_version
  OR NEW.request_key<>OLD.request_key OR NEW.request_fingerprint<>OLD.request_fingerprint
  OR NEW.requested_by<>OLD.requested_by OR NEW.requested_at<>OLD.requested_at OR OLD.status<>'PENDING'
  OR NEW.status NOT IN ('APPROVED','REJECTED','CANCELLED')
  OR NOT EXISTS (
    SELECT 1 FROM preview_project_schedule_profiles p JOIN preview_users u ON u.id=NEW.reviewed_by AND u.is_active=1
    WHERE p.case_id=NEW.case_id AND (p.responsible_pm_id=NEW.reviewed_by OR EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value)='admin'))
  )
  OR (NEW.status='APPROVED' AND NOT EXISTS (
    SELECT 1 FROM preview_project_stage_schedules s WHERE s.case_id=NEW.case_id AND s.stage_code=NEW.stage_code
      AND s.start_date=NEW.proposed_start_date AND s.end_date=NEW.proposed_end_date
      AND s.version=NEW.expected_schedule_version+1 AND s.updated_by=NEW.reviewed_by
  ))
BEGIN SELECT RAISE(ABORT,'schedule change request decision is invalid'); END;

CREATE TRIGGER preview_project_notification_insert_guard BEFORE INSERT ON preview_project_notifications
WHEN NOT EXISTS (
  SELECT 1 FROM preview_schedule_change_requests r JOIN preview_users u ON u.id=NEW.user_id AND u.is_active=1
  JOIN preview_cases c ON c.id=NEW.case_id AND c.organization_id=NEW.organization_id
  WHERE r.id=NEW.change_request_id AND r.case_id=NEW.case_id
    AND ((NEW.notification_type='SCHEDULE_CHANGE_REQUESTED' AND r.status='PENDING')
      OR (NEW.notification_type='SCHEDULE_CHANGE_APPROVED' AND r.status='APPROVED')
      OR (NEW.notification_type='SCHEDULE_CHANGE_REJECTED' AND r.status='REJECTED'))
) BEGIN SELECT RAISE(ABORT,'project notification scope is invalid'); END;

CREATE TRIGGER preview_workflow_ai_import_insert_guard BEFORE INSERT ON preview_workflow_ai_imports
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by AND u.is_active=1
  JOIN preview_case_assignments a ON a.case_id=c.id AND a.user_id=u.id
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
) OR (NEW.status<>'BLOCKED_BY_POLICY' AND NEW.data_class IN ('CONFIDENTIAL','RESTRICTED') AND NOT EXISTS (
  SELECT 1 FROM preview_ai_data_governance g WHERE g.organization_id=NEW.organization_id AND g.confidential_external_ai_enabled=1
    AND g.provider_service_tier IN ('PAID_NO_PRODUCT_IMPROVEMENT','VERTEX_AI_ENTERPRISE')
)) BEGIN SELECT RAISE(ABORT,'workflow AI import is outside approved data policy'); END;

CREATE TRIGGER preview_ai_governance_update_guard BEFORE UPDATE ON preview_ai_data_governance
WHEN NEW.organization_id<>OLD.organization_id OR NEW.provider_kind<>OLD.provider_kind OR NEW.provider_terms_url<>OLD.provider_terms_url
  OR NEW.minimize_personal_data<>1 OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.acknowledged_by AND u.is_active=1 AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value)='admin'))
BEGIN SELECT RAISE(ABORT,'AI governance update requires active Admin acknowledgement'); END;

CREATE TRIGGER preview_schedule_profile_delete_guard BEFORE DELETE ON preview_project_schedule_profiles BEGIN SELECT RAISE(ABORT,'schedule profiles cannot be deleted'); END;
CREATE TRIGGER preview_stage_schedule_delete_guard BEFORE DELETE ON preview_project_stage_schedules BEGIN SELECT RAISE(ABORT,'stage schedules cannot be deleted'); END;
CREATE TRIGGER preview_schedule_request_delete_guard BEFORE DELETE ON preview_schedule_change_requests BEGIN SELECT RAISE(ABORT,'schedule change requests cannot be deleted'); END;
CREATE TRIGGER preview_project_notification_delete_guard BEFORE DELETE ON preview_project_notifications BEGIN SELECT RAISE(ABORT,'project notifications cannot be deleted'); END;
CREATE TRIGGER preview_workflow_ai_import_update_guard BEFORE UPDATE ON preview_workflow_ai_imports BEGIN SELECT RAISE(ABORT,'workflow AI import audit is append-only'); END;
CREATE TRIGGER preview_workflow_ai_import_delete_guard BEFORE DELETE ON preview_workflow_ai_imports BEGIN SELECT RAISE(ABORT,'workflow AI import audit is append-only'); END;

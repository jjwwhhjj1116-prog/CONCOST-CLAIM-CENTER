-- CF36: real workflow projection, guided first-run decision, executive approval
-- notifications, and client-side legal-position/audio intake records.

ALTER TABLE preview_cases ADD COLUMN client_legal_position TEXT NOT NULL DEFAULT 'UNSPECIFIED'
  CHECK (client_legal_position IN ('VICTIM','SUSPECT','OTHER','UNSPECIFIED'));
ALTER TABLE preview_cases ADD COLUMN client_position_detail TEXT
  CHECK (client_position_detail IS NULL OR length(client_position_detail) <= 2000);

ALTER TABLE preview_user_tutorial_state ADD COLUMN completion_action TEXT NOT NULL DEFAULT 'COMPLETED'
  CHECK (completion_action IN ('COMPLETED','SKIPPED'));
ALTER TABLE preview_user_tutorial_history ADD COLUMN completion_action TEXT NOT NULL DEFAULT 'COMPLETED'
  CHECK (completion_action IN ('COMPLETED','SKIPPED'));

DROP TRIGGER IF EXISTS preview_user_tutorial_history_insert_guard;
CREATE TRIGGER preview_user_tutorial_history_insert_guard
BEFORE INSERT ON preview_user_tutorial_history
WHEN NEW.user_id<>NEW.completed_by OR NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.completed_by AND u.is_active=1
) OR NOT EXISTS (
  SELECT 1 FROM preview_user_tutorial_state s
  WHERE s.user_id=NEW.user_id AND s.completed_tutorial_version=NEW.tutorial_version
    AND s.version=NEW.state_version AND s.completed_at=NEW.completed_at
    AND s.completion_action=NEW.completion_action
)
BEGIN SELECT RAISE(ABORT,'tutorial history must match the active owner state'); END;

CREATE TABLE preview_intake_audio_operations (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint)=64),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  google_file_id TEXT,
  error_code TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id,case_id,idempotency_key),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE preview_intake_audio_evidence (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 240),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/webm')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10000000),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  google_file_id TEXT NOT NULL UNIQUE CHECK (length(google_file_id) BETWEEN 10 AND 200),
  google_folder_id TEXT NOT NULL CHECK (length(google_folder_id) BETWEEN 10 AND 200),
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (operation_id) REFERENCES preview_intake_audio_operations(id),
  FOREIGN KEY (uploaded_by) REFERENCES preview_users(id)
);

CREATE TABLE preview_intake_audio_summaries (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL UNIQUE,
  client_legal_position TEXT NOT NULL CHECK (client_legal_position IN ('VICTIM','SUSPECT','OTHER')),
  summary_text TEXT NOT NULL CHECK (length(summary_text) BETWEEN 1 AND 30000),
  provider_kind TEXT NOT NULL CHECK (provider_kind='GEMINI'),
  model_code TEXT NOT NULL CHECK (length(model_code) BETWEEN 3 AND 100),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (evidence_id) REFERENCES preview_intake_audio_evidence(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE INDEX idx_preview_intake_audio_case ON preview_intake_audio_evidence(case_id,uploaded_at DESC);
CREATE INDEX idx_preview_intake_summary_case ON preview_intake_audio_summaries(case_id,created_at DESC);

CREATE TRIGGER preview_intake_audio_operation_insert_guard BEFORE INSERT ON preview_intake_audio_operations
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by AND u.is_active=1
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
    AND (instr(u.roles_json,'"admin"')>0 OR instr(u.roles_json,'"ceo"')>0 OR instr(u.roles_json,'"director"')>0 OR instr(u.roles_json,'"pm"')>0 OR instr(u.roles_json,'"staff"')>0)
    AND (instr(u.roles_json,'"admin"')>0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=NEW.created_by))
)
BEGIN SELECT RAISE(ABORT,'intake audio operation scope is invalid'); END;

CREATE TRIGGER preview_intake_audio_operation_update_guard BEFORE UPDATE ON preview_intake_audio_operations
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.case_id<>OLD.case_id
  OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_fingerprint<>OLD.request_fingerprint
  OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.updated_at<=OLD.updated_at
  OR OLD.status<>'PENDING' OR NEW.status NOT IN ('SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')
BEGIN SELECT RAISE(ABORT,'intake audio operation transition is invalid'); END;
CREATE TRIGGER preview_intake_audio_operation_delete_guard BEFORE DELETE ON preview_intake_audio_operations
BEGIN SELECT RAISE(ABORT,'intake audio operations are append-only'); END;

CREATE TRIGGER preview_intake_audio_evidence_insert_guard BEFORE INSERT ON preview_intake_audio_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM preview_intake_audio_operations o
  WHERE o.id=NEW.operation_id AND o.organization_id=NEW.organization_id AND o.case_id=NEW.case_id
    AND o.status='PENDING' AND o.created_by=NEW.uploaded_by
)
BEGIN SELECT RAISE(ABORT,'intake audio evidence requires its pending operation'); END;
CREATE TRIGGER preview_intake_audio_evidence_update_guard BEFORE UPDATE ON preview_intake_audio_evidence
BEGIN SELECT RAISE(ABORT,'intake audio evidence is append-only'); END;
CREATE TRIGGER preview_intake_audio_evidence_delete_guard BEFORE DELETE ON preview_intake_audio_evidence
BEGIN SELECT RAISE(ABORT,'intake audio evidence is append-only'); END;

CREATE TRIGGER preview_intake_audio_summary_insert_guard BEFORE INSERT ON preview_intake_audio_summaries
WHEN NOT EXISTS (
  SELECT 1 FROM preview_intake_audio_evidence e JOIN preview_cases c ON c.id=e.case_id
  WHERE e.id=NEW.evidence_id AND e.case_id=NEW.case_id AND e.organization_id=NEW.organization_id
    AND e.uploaded_by=NEW.created_by AND c.client_legal_position=NEW.client_legal_position
)
BEGIN SELECT RAISE(ABORT,'intake audio summary source or client position is invalid'); END;
CREATE TRIGGER preview_intake_audio_summary_update_guard BEFORE UPDATE ON preview_intake_audio_summaries
BEGIN SELECT RAISE(ABORT,'intake audio summaries are append-only'); END;
CREATE TRIGGER preview_intake_audio_summary_delete_guard BEFORE DELETE ON preview_intake_audio_summaries
BEGIN SELECT RAISE(ABORT,'intake audio summaries are append-only'); END;

CREATE TABLE preview_notifications (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id='concost'),
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  review_id TEXT,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('REPORT_APPROVED_DELIVERY_REQUIRED')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id,review_id,notification_type),
  FOREIGN KEY (user_id) REFERENCES preview_users(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (review_id) REFERENCES preview_report_reviews(id)
);

CREATE TABLE preview_email_outbox (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id='concost'),
  notification_id TEXT NOT NULL UNIQUE,
  recipient_user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL CHECK (recipient_email LIKE '%_@_%._%'),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  body_text TEXT NOT NULL CHECK (length(body_text) BETWEEN 1 AND 5000),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','CONFIG_REQUIRED','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (notification_id) REFERENCES preview_notifications(id),
  FOREIGN KEY (recipient_user_id) REFERENCES preview_users(id)
);

CREATE INDEX idx_preview_notifications_user ON preview_notifications(user_id,created_at DESC);
CREATE INDEX idx_preview_email_outbox_status ON preview_email_outbox(status,created_at);

CREATE TRIGGER preview_notification_insert_guard BEFORE INSERT ON preview_notifications
WHEN NOT EXISTS (
  SELECT 1 FROM preview_report_reviews r JOIN preview_users u ON u.id=NEW.user_id AND u.is_active=1
  WHERE r.id=NEW.review_id AND r.case_id=NEW.case_id AND r.status='APPROVED'
    AND (instr(u.roles_json,'"pm"')>0 OR u.id=r.requested_by)
)
BEGIN SELECT RAISE(ABORT,'delivery notification requires approved review and active PM'); END;
CREATE TRIGGER preview_notification_identity_guard BEFORE UPDATE ON preview_notifications
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.user_id<>OLD.user_id
  OR NEW.case_id<>OLD.case_id OR NEW.review_id<>OLD.review_id OR NEW.notification_type<>OLD.notification_type
  OR NEW.title<>OLD.title OR NEW.message<>OLD.message OR NEW.created_at<>OLD.created_at
  OR (OLD.read_at IS NOT NULL AND NEW.read_at<>OLD.read_at)
BEGIN SELECT RAISE(ABORT,'notification identity is immutable'); END;
CREATE TRIGGER preview_notification_delete_guard BEFORE DELETE ON preview_notifications
BEGIN SELECT RAISE(ABORT,'notifications cannot be deleted'); END;

CREATE TRIGGER preview_email_outbox_insert_guard BEFORE INSERT ON preview_email_outbox
WHEN NOT EXISTS (
  SELECT 1 FROM preview_notifications n JOIN preview_users u ON u.id=NEW.recipient_user_id
  WHERE n.id=NEW.notification_id AND n.user_id=NEW.recipient_user_id
    AND lower(u.email)=lower(NEW.recipient_email) AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'email outbox recipient is invalid'); END;
CREATE TRIGGER preview_email_outbox_update_guard BEFORE UPDATE ON preview_email_outbox
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.notification_id<>OLD.notification_id
  OR NEW.recipient_user_id<>OLD.recipient_user_id OR NEW.recipient_email<>OLD.recipient_email
  OR NEW.subject<>OLD.subject OR NEW.body_text<>OLD.body_text OR NEW.created_at<>OLD.created_at
  OR NEW.attempt_count<>OLD.attempt_count+1 OR NEW.updated_at<=OLD.updated_at
  OR OLD.status NOT IN ('PENDING','CONFIG_REQUIRED','FAILED') OR NEW.status NOT IN ('SENT','CONFIG_REQUIRED','FAILED')
BEGIN SELECT RAISE(ABORT,'email outbox transition is invalid'); END;
CREATE TRIGGER preview_email_outbox_delete_guard BEFORE DELETE ON preview_email_outbox
BEGIN SELECT RAISE(ABORT,'email outbox is immutable'); END;

-- Only the independent CEO/Director authority can issue a final approval.
CREATE TRIGGER preview_report_review_executive_approval_guard
BEFORE UPDATE ON preview_report_reviews
WHEN NEW.status='APPROVED' AND NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.reviewed_by AND u.is_active=1
    AND (instr(u.roles_json,'"ceo"')>0 OR instr(u.roles_json,'"director"')>0)
)
BEGIN SELECT RAISE(ABORT,'final report approval requires CEO or Director authority'); END;

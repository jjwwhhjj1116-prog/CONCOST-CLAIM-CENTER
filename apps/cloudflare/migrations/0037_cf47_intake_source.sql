-- CF47: extend project-intake Gemini sources from audio to UTF-8 text, CSV and XLSX.
-- The legacy table names remain stable so existing report/proposal queries and audit rows keep working.

DROP TRIGGER IF EXISTS preview_intake_audio_evidence_insert_guard;
DROP TRIGGER IF EXISTS preview_intake_audio_evidence_update_guard;
DROP TRIGGER IF EXISTS preview_intake_audio_evidence_delete_guard;
DROP TRIGGER IF EXISTS preview_intake_audio_summary_insert_guard;
DROP TRIGGER IF EXISTS preview_intake_audio_summary_update_guard;
DROP TRIGGER IF EXISTS preview_intake_audio_summary_delete_guard;

ALTER TABLE preview_intake_audio_summaries RENAME TO preview_intake_audio_summaries_cf36;
ALTER TABLE preview_intake_audio_evidence RENAME TO preview_intake_audio_evidence_cf36;

CREATE TABLE preview_intake_audio_evidence (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 240),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/webm',
    'text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
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

INSERT INTO preview_intake_audio_evidence
SELECT * FROM preview_intake_audio_evidence_cf36;

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

INSERT INTO preview_intake_audio_summaries
SELECT * FROM preview_intake_audio_summaries_cf36;

DROP TABLE preview_intake_audio_summaries_cf36;
DROP TABLE preview_intake_audio_evidence_cf36;

CREATE INDEX idx_preview_intake_audio_case ON preview_intake_audio_evidence(case_id,uploaded_at DESC);
CREATE INDEX idx_preview_intake_summary_case ON preview_intake_audio_summaries(case_id,created_at DESC);

CREATE TRIGGER preview_intake_audio_evidence_insert_guard BEFORE INSERT ON preview_intake_audio_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM preview_intake_audio_operations o
  WHERE o.id=NEW.operation_id AND o.organization_id=NEW.organization_id AND o.case_id=NEW.case_id
    AND o.status='PENDING' AND o.created_by=NEW.uploaded_by
)
BEGIN SELECT RAISE(ABORT,'intake source evidence requires its pending operation'); END;
CREATE TRIGGER preview_intake_audio_evidence_update_guard BEFORE UPDATE ON preview_intake_audio_evidence
BEGIN SELECT RAISE(ABORT,'intake source evidence is append-only'); END;
CREATE TRIGGER preview_intake_audio_evidence_delete_guard BEFORE DELETE ON preview_intake_audio_evidence
BEGIN SELECT RAISE(ABORT,'intake source evidence is append-only'); END;

CREATE TRIGGER preview_intake_audio_summary_insert_guard BEFORE INSERT ON preview_intake_audio_summaries
WHEN NOT EXISTS (
  SELECT 1 FROM preview_intake_audio_evidence e JOIN preview_cases c ON c.id=e.case_id
  WHERE e.id=NEW.evidence_id AND e.case_id=NEW.case_id AND e.organization_id=NEW.organization_id
    AND e.uploaded_by=NEW.created_by AND c.client_legal_position=NEW.client_legal_position
)
BEGIN SELECT RAISE(ABORT,'intake source summary or client position is invalid'); END;
CREATE TRIGGER preview_intake_audio_summary_update_guard BEFORE UPDATE ON preview_intake_audio_summaries
BEGIN SELECT RAISE(ABORT,'intake source summaries are append-only'); END;
CREATE TRIGGER preview_intake_audio_summary_delete_guard BEFORE DELETE ON preview_intake_audio_summaries
BEGIN SELECT RAISE(ABORT,'intake source summaries are append-only'); END;

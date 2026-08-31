-- CF73: Persist the human-reviewed site-survey source and generated output
-- without rebuilding or deleting the existing survey ledger.

CREATE TABLE IF NOT EXISTS preview_site_survey_outputs (
  survey_id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  source_notes TEXT NOT NULL DEFAULT '',
  summary_text TEXT NOT NULL DEFAULT '',
  timeline_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'DRAFTED',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (length(source_notes) <= 50000),
  CHECK (length(summary_text) <= 30000),
  CHECK (json_valid(timeline_json) AND json_type(timeline_json) = 'array'),
  CHECK (status IN ('DRAFTED','CONFIRMED')),
  CHECK (version >= 1),
  FOREIGN KEY (survey_id) REFERENCES preview_site_surveys(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_site_survey_outputs_case
  ON preview_site_survey_outputs(case_id, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_site_survey_output_insert_guard
BEFORE INSERT ON preview_site_survey_outputs
WHEN NOT EXISTS (
  SELECT 1
  FROM preview_site_surveys survey
  JOIN preview_users actor ON actor.id = NEW.updated_by AND actor.is_active = 1
  WHERE survey.id = NEW.survey_id
    AND survey.case_id = NEW.case_id
    AND survey.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'site survey output scope is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_site_survey_output_update_guard
BEFORE UPDATE ON preview_site_survey_outputs
WHEN NEW.survey_id <> OLD.survey_id
  OR NEW.case_id <> OLD.case_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1
  OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'site survey output optimistic version is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_site_survey_output_delete_guard
BEFORE DELETE ON preview_site_survey_outputs
BEGIN SELECT RAISE(ABORT, 'site survey output cannot be deleted'); END;

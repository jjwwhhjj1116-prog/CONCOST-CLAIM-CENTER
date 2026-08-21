-- CF39: expand the project evidence library across the complete claim workflow.
--
-- The original category column is intentionally retained as a two-value legacy
-- compatibility projection. workflow_category is the authoritative category for
-- every new read/write so the already-applied CF15/CF30 migrations remain immutable.

ALTER TABLE preview_case_evidence
  ADD COLUMN workflow_category TEXT NOT NULL DEFAULT 'TAKEOFF_SOURCE'
  CHECK (workflow_category IN (
    'INTAKE_REFERENCE','PROPOSAL_REFERENCE','KICKOFF_MATERIAL','MEETING_MINUTES','MEETING_RECORDING',
    'SITE_PHOTO','SITE_RECORDING','SITE_DOCUMENT','TAKEOFF_SOURCE','COST_BREAKDOWN',
    'REPORT_REFERENCE','COURT_DOCUMENT','FINAL_DELIVERABLE'
  ));

ALTER TABLE preview_google_case_operations
  ADD COLUMN workflow_category TEXT NOT NULL DEFAULT 'TAKEOFF_SOURCE'
  CHECK (workflow_category IN (
    'INTAKE_REFERENCE','PROPOSAL_REFERENCE','KICKOFF_MATERIAL','MEETING_MINUTES','MEETING_RECORDING',
    'SITE_PHOTO','SITE_RECORDING','SITE_DOCUMENT','TAKEOFF_SOURCE','COST_BREAKDOWN',
    'REPORT_REFERENCE','COURT_DOCUMENT','FINAL_DELIVERABLE'
  ));

ALTER TABLE preview_google_case_evidence
  ADD COLUMN workflow_category TEXT NOT NULL DEFAULT 'TAKEOFF_SOURCE'
  CHECK (workflow_category IN (
    'INTAKE_REFERENCE','PROPOSAL_REFERENCE','KICKOFF_MATERIAL','MEETING_MINUTES','MEETING_RECORDING',
    'SITE_PHOTO','SITE_RECORDING','SITE_DOCUMENT','TAKEOFF_SOURCE','COST_BREAKDOWN',
    'REPORT_REFERENCE','COURT_DOCUMENT','FINAL_DELIVERABLE'
  ));

UPDATE preview_case_evidence SET workflow_category=category;
UPDATE preview_google_case_operations SET workflow_category=category;
UPDATE preview_google_case_evidence SET workflow_category=category;

CREATE INDEX IF NOT EXISTS idx_preview_case_evidence_workflow_category
  ON preview_case_evidence(case_id,workflow_category,uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_preview_google_case_evidence_workflow_category
  ON preview_google_case_evidence(case_id,workflow_category,uploaded_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_google_case_operation_workflow_identity_guard
BEFORE UPDATE OF workflow_category ON preview_google_case_operations
WHEN NEW.workflow_category<>OLD.workflow_category
BEGIN
  SELECT RAISE(ABORT,'Google case operation workflow category is immutable');
END;

CREATE TRIGGER IF NOT EXISTS preview_google_case_evidence_workflow_guard
BEFORE INSERT ON preview_google_case_evidence
BEGIN
  SELECT RAISE(ABORT,'Google evidence workflow category must match its operation')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_google_case_operations o
    WHERE o.id=NEW.operation_id
      AND o.organization_id=NEW.organization_id
      AND o.case_id=NEW.case_id
      AND o.workflow_category=NEW.workflow_category
  );
END;

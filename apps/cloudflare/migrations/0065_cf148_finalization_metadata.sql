-- Freeze display metadata without rewriting existing approvals or output hashes.
CREATE TABLE IF NOT EXISTS preview_report_finalization_metadata (
  finalization_id TEXT PRIMARY KEY REFERENCES preview_report_finalizations(id) ON DELETE RESTRICT,
  case_number TEXT NOT NULL,
  case_title TEXT NOT NULL,
  approved_by_name TEXT NOT NULL,
  finalized_by_name TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS preview_finalization_metadata_no_update
BEFORE UPDATE ON preview_report_finalization_metadata BEGIN
  SELECT RAISE(ABORT,'Finalization metadata is immutable');
END;
CREATE TRIGGER IF NOT EXISTS preview_finalization_metadata_no_delete
BEFORE DELETE ON preview_report_finalization_metadata BEGIN
  SELECT RAISE(ABORT,'Finalization metadata is immutable');
END;

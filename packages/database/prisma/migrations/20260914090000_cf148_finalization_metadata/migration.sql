-- Additive SQLite counterpart. Legacy Node output uses its own finalization service;
-- no existing source, approval, artifact or credential is backfilled or rewritten.
CREATE TABLE IF NOT EXISTS "ReportFinalizationMetadata" (
  "finalizationId" TEXT PRIMARY KEY NOT NULL REFERENCES "ReportFinalization"("id") ON DELETE RESTRICT,
  "caseNumber" TEXT NOT NULL,
  "caseTitle" TEXT NOT NULL,
  "approvedByName" TEXT NOT NULL,
  "finalizedByName" TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS "ReportFinalizationMetadata_no_update"
BEFORE UPDATE ON "ReportFinalizationMetadata" BEGIN
  SELECT RAISE(ABORT,'Finalization metadata is immutable');
END;
CREATE TRIGGER IF NOT EXISTS "ReportFinalizationMetadata_no_delete"
BEFORE DELETE ON "ReportFinalizationMetadata" BEGIN
  SELECT RAISE(ABORT,'Finalization metadata is immutable');
END;

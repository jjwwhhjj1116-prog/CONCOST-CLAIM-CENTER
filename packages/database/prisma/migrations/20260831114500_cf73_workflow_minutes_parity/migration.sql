-- SQLite parity for CF73. This additive table never replaces dev.db or an
-- existing workflow table; production applies it through the migration ledger.
CREATE TABLE IF NOT EXISTS "preview_site_survey_outputs" (
  "survey_id" TEXT NOT NULL PRIMARY KEY,
  "case_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'concost',
  "source_notes" TEXT NOT NULL DEFAULT '',
  "summary_text" TEXT NOT NULL DEFAULT '',
  "timeline_json" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'DRAFTED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK ("organization_id" = 'concost'),
  CHECK (length("source_notes") <= 50000),
  CHECK (length("summary_text") <= 30000),
  CHECK (json_valid("timeline_json") AND json_type("timeline_json") = 'array'),
  CHECK ("status" IN ('DRAFTED','CONFIRMED')),
  CHECK ("version" >= 1)
);

CREATE INDEX IF NOT EXISTS "idx_preview_site_survey_outputs_case"
  ON "preview_site_survey_outputs"("case_id", "updated_at" DESC);

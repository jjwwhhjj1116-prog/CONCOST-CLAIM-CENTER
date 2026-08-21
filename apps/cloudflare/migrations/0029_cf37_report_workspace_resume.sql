-- CF37: persist the report writer's last wizard position so work can resume
-- after navigating to another category or signing in again.

ALTER TABLE preview_report_drafts
  ADD COLUMN wizard_step INTEGER NOT NULL DEFAULT 1 CHECK (wizard_step BETWEEN 1 AND 5);

ALTER TABLE preview_report_drafts
  ADD COLUMN selected_chapter_id TEXT CHECK (selected_chapter_id IS NULL OR (length(selected_chapter_id) BETWEEN 1 AND 100));

CREATE INDEX IF NOT EXISTS idx_preview_report_drafts_resume
  ON preview_report_drafts (organization_id, updated_at DESC);

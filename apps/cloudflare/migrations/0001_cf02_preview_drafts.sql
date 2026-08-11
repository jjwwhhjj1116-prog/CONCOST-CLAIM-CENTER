-- CF02: Browser-keyed preview draft persistence.
CREATE TABLE IF NOT EXISTS preview_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  CHECK (length(id) = 64),
  CHECK (length(title) <= 200),
  CHECK (length(content) <= 65536)
);

CREATE INDEX IF NOT EXISTS idx_preview_drafts_updated_at
  ON preview_drafts(updated_at);

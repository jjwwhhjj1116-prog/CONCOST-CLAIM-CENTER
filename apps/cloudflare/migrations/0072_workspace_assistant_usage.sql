-- Only account/day counters; no questions, answers, keys or customer content.
CREATE TABLE IF NOT EXISTS preview_workspace_assistant_usage (
 organization_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 quota_day TEXT NOT NULL CHECK (length(quota_day)=10),
 used INTEGER NOT NULL CHECK (used BETWEEN 1 AND 20),
 updated_at TEXT NOT NULL,
 PRIMARY KEY (organization_id,user_id,quota_day)
);

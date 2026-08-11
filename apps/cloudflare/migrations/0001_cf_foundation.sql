CREATE TABLE IF NOT EXISTS cf_deployment_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cf_deployment_metadata (key, value)
VALUES ('schema_phase', 'CF01_FOUNDATION')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;

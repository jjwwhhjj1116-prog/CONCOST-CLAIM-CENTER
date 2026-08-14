-- CF19: role-based, multi-provider report AI routing.
-- API keys remain Cloudflare Secrets and are never persisted in D1.

CREATE TABLE IF NOT EXISTS preview_report_ai_routes (
  organization_id TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model_code TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL DEFAULT 'medium',
  secret_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, task_kind),
  CHECK (organization_id = 'concost'),
  CHECK (task_kind IN ('OUTLINE_PLANNING','CHAPTER_WRITING','FACT_CHECK')),
  CHECK (provider_kind IN ('OPENAI','ANTHROPIC','GEMINI')),
  CHECK (reasoning_effort IN ('minimal','low','medium','high','xhigh','max')),
  CHECK (
    (provider_kind = 'OPENAI' AND secret_name = 'OPENAI_API_KEY' AND model_code IN ('gpt-5.6','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna')) OR
    (provider_kind = 'ANTHROPIC' AND secret_name = 'ANTHROPIC_API_KEY' AND model_code IN ('claude-fable-5','claude-opus-5','claude-sonnet-5','claude-haiku-4-5-20251001')) OR
    (provider_kind = 'GEMINI' AND secret_name = 'GEMINI_API_KEY' AND model_code IN ('gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite'))
  ),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_ai_route_history (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  model_code TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  UNIQUE (organization_id, task_kind, version),
  FOREIGN KEY (organization_id, task_kind) REFERENCES preview_report_ai_routes(organization_id, task_kind),
  FOREIGN KEY (changed_by) REFERENCES preview_users(id)
);

INSERT OR IGNORE INTO preview_report_ai_routes
  (organization_id, task_kind, provider_kind, model_code, reasoning_effort, secret_name, version, updated_by, updated_at)
SELECT 'concost', 'OUTLINE_PLANNING', 'OPENAI', 'gpt-5.6', 'medium', 'OPENAI_API_KEY', 1, id, CURRENT_TIMESTAMP
FROM preview_users WHERE is_active = 1 AND instr(roles_json, '"admin"') > 0 ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO preview_report_ai_routes
  (organization_id, task_kind, provider_kind, model_code, reasoning_effort, secret_name, version, updated_by, updated_at)
SELECT 'concost', 'CHAPTER_WRITING', 'GEMINI', 'gemini-3.6-flash', 'medium', 'GEMINI_API_KEY', 1, id, CURRENT_TIMESTAMP
FROM preview_users WHERE is_active = 1 AND instr(roles_json, '"admin"') > 0 ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO preview_report_ai_routes
  (organization_id, task_kind, provider_kind, model_code, reasoning_effort, secret_name, version, updated_by, updated_at)
SELECT 'concost', 'FACT_CHECK', 'GEMINI', 'gemini-3.5-flash-lite', 'minimal', 'GEMINI_API_KEY', 1, id, CURRENT_TIMESTAMP
FROM preview_users WHERE is_active = 1 AND instr(roles_json, '"admin"') > 0 ORDER BY id LIMIT 1;

ALTER TABLE preview_report_ai_generations ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'OPENAI';
ALTER TABLE preview_report_ai_generations ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'CHAPTER_WRITING';

CREATE TRIGGER IF NOT EXISTS preview_report_ai_routes_admin_update
BEFORE UPDATE ON preview_report_ai_routes
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id = NEW.updated_by AND u.is_active = 1 AND instr(u.roles_json, '"admin"') > 0
) OR NEW.organization_id <> OLD.organization_id OR NEW.task_kind <> OLD.task_kind
  OR NEW.secret_name <> CASE NEW.provider_kind WHEN 'OPENAI' THEN 'OPENAI_API_KEY' WHEN 'ANTHROPIC' THEN 'ANTHROPIC_API_KEY' ELSE 'GEMINI_API_KEY' END
  OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'report AI routes require active Admin and optimistic version');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_ai_routes_delete_guard
BEFORE DELETE ON preview_report_ai_routes
BEGIN
  SELECT RAISE(ABORT, 'report AI routes cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_ai_route_history_update_guard
BEFORE UPDATE ON preview_report_ai_route_history
BEGIN
  SELECT RAISE(ABORT, 'report AI route history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_ai_route_history_delete_guard
BEFORE DELETE ON preview_report_ai_route_history
BEGIN
  SELECT RAISE(ABORT, 'report AI route history is append-only');
END;

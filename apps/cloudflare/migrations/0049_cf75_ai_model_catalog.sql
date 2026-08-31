-- CF75: keep existing AI routing data while adding the current production model catalog.
-- SQLite CHECK constraints require a table rebuild; history is rebuilt with the same rows.

DROP TRIGGER IF EXISTS preview_report_ai_routes_admin_update;
DROP TRIGGER IF EXISTS preview_report_ai_routes_delete_guard;
DROP TRIGGER IF EXISTS preview_report_ai_route_history_update_guard;
DROP TRIGGER IF EXISTS preview_report_ai_route_history_delete_guard;

ALTER TABLE preview_report_ai_route_history RENAME TO preview_report_ai_route_history_cf75_old;
ALTER TABLE preview_report_ai_routes RENAME TO preview_report_ai_routes_cf75_old;

CREATE TABLE preview_report_ai_routes (
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
    (provider_kind = 'GEMINI' AND secret_name = 'GEMINI_API_KEY' AND model_code IN ('gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite'))
  ),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

INSERT INTO preview_report_ai_routes
  (organization_id,task_kind,provider_kind,model_code,reasoning_effort,secret_name,version,updated_by,updated_at)
SELECT organization_id,task_kind,provider_kind,model_code,reasoning_effort,secret_name,version,updated_by,updated_at
FROM preview_report_ai_routes_cf75_old;

INSERT OR IGNORE INTO preview_report_ai_routes
  (organization_id,task_kind,provider_kind,model_code,reasoning_effort,secret_name,version,updated_by,updated_at)
SELECT 'concost','OUTLINE_PLANNING','OPENAI','gpt-5.6-sol','high','OPENAI_API_KEY',1,id,CURRENT_TIMESTAMP
FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO preview_report_ai_routes
  (organization_id,task_kind,provider_kind,model_code,reasoning_effort,secret_name,version,updated_by,updated_at)
SELECT 'concost','CHAPTER_WRITING','ANTHROPIC','claude-sonnet-5','high','ANTHROPIC_API_KEY',1,id,CURRENT_TIMESTAMP
FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO preview_report_ai_routes
  (organization_id,task_kind,provider_kind,model_code,reasoning_effort,secret_name,version,updated_by,updated_at)
SELECT 'concost','FACT_CHECK','GEMINI','gemini-3.7-flash','medium','GEMINI_API_KEY',1,id,CURRENT_TIMESTAMP
FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1;

CREATE TABLE preview_report_ai_route_history (
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

INSERT INTO preview_report_ai_route_history
  (id,organization_id,task_kind,provider_kind,model_code,reasoning_effort,version,changed_by,changed_at)
SELECT id,organization_id,task_kind,provider_kind,model_code,reasoning_effort,version,changed_by,changed_at
FROM preview_report_ai_route_history_cf75_old;

DROP TABLE preview_report_ai_route_history_cf75_old;
DROP TABLE preview_report_ai_routes_cf75_old;

CREATE TRIGGER preview_report_ai_routes_admin_update
BEFORE UPDATE ON preview_report_ai_routes
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
) OR NEW.organization_id<>OLD.organization_id OR NEW.task_kind<>OLD.task_kind
  OR NEW.secret_name<>CASE NEW.provider_kind WHEN 'OPENAI' THEN 'OPENAI_API_KEY' WHEN 'ANTHROPIC' THEN 'ANTHROPIC_API_KEY' ELSE 'GEMINI_API_KEY' END
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'report AI routes require active Admin and optimistic version');
END;

CREATE TRIGGER preview_report_ai_routes_delete_guard
BEFORE DELETE ON preview_report_ai_routes
BEGIN
  SELECT RAISE(ABORT,'report AI routes cannot be deleted');
END;

CREATE TRIGGER preview_report_ai_route_history_update_guard
BEFORE UPDATE ON preview_report_ai_route_history
BEGIN
  SELECT RAISE(ABORT,'report AI route history is append-only');
END;

CREATE TRIGGER preview_report_ai_route_history_delete_guard
BEFORE DELETE ON preview_report_ai_route_history
BEGIN
  SELECT RAISE(ABORT,'report AI route history is append-only');
END;

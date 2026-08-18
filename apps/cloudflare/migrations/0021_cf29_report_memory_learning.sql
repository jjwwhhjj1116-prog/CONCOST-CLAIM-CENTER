-- CF29: real feedback -> candidate -> Admin approval -> retrieval loop.

CREATE TABLE IF NOT EXISTS preview_report_generation_snapshots (
  generation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  chapter_code TEXT NOT NULL CHECK (length(chapter_code) BETWEEN 3 AND 32),
  output_text TEXT NOT NULL CHECK (length(output_text) BETWEEN 1 AND 500000),
  output_sha256 TEXT NOT NULL CHECK (length(output_sha256)=64),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (generation_id) REFERENCES preview_report_ai_generations(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (prompt_id) REFERENCES preview_report_chapter_prompts(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_feedback (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  chapter_code TEXT NOT NULL,
  feedback_text TEXT NOT NULL CHECK (length(feedback_text) BETWEEN 3 AND 2000),
  ai_output_sha256 TEXT NOT NULL CHECK (length(ai_output_sha256)=64),
  human_text_sha256 TEXT NOT NULL CHECK (length(human_text_sha256)=64),
  diff_json TEXT NOT NULL CHECK (json_valid(diff_json)),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, case_id, request_key),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (generation_id) REFERENCES preview_report_generation_snapshots(generation_id),
  FOREIGN KEY (prompt_id) REFERENCES preview_report_chapter_prompts(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_memory_candidates (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  organization_id TEXT NOT NULL CHECK (organization_id='concost'),
  feedback_id TEXT NOT NULL UNIQUE,
  memory_scope TEXT NOT NULL CHECK (memory_scope IN ('GLOBAL','REPORT_TYPE','CLAIM_TYPE','CHAPTER','CLIENT','USER_FEEDBACK')),
  scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 160),
  problem_text TEXT NOT NULL CHECK (length(problem_text) BETWEEN 3 AND 800),
  rule_text TEXT NOT NULL CHECK (length(rule_text) BETWEEN 3 AND 800),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  analyzer_code TEXT NOT NULL CHECK (analyzer_code='HERMES_COMPATIBLE_RULE_ENGINE_V1'),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','REJECTED','DISABLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  FOREIGN KEY (feedback_id) REFERENCES preview_report_feedback(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id),
  FOREIGN KEY (reviewed_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_memory_usage (
  id TEXT PRIMARY KEY CHECK (length(id)=36),
  generation_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  UNIQUE (generation_id,memory_id),
  FOREIGN KEY (generation_id) REFERENCES preview_report_generation_snapshots(generation_id),
  FOREIGN KEY (memory_id) REFERENCES preview_memory_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_memory_candidates_retrieval
  ON preview_memory_candidates(status,memory_scope,scope_key,confidence DESC,reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_report_feedback_case
  ON preview_report_feedback(case_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_generation_snapshot_insert_guard
BEFORE INSERT ON preview_report_generation_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM preview_report_ai_generations g JOIN preview_cases c ON c.id=g.case_id
  JOIN preview_report_chapter_prompts p ON p.id=g.prompt_id
  JOIN preview_users u ON u.id=g.actor_id
  WHERE g.id=NEW.generation_id AND g.organization_id=NEW.organization_id AND g.case_id=NEW.case_id
    AND g.prompt_id=NEW.prompt_id AND g.output_sha256=NEW.output_sha256 AND g.actor_id=NEW.created_by
    AND c.organization_id=NEW.organization_id AND p.chapter_code=NEW.chapter_code AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'generation snapshot must match the server AI ledger'); END;

CREATE TRIGGER IF NOT EXISTS preview_generation_snapshot_update_guard BEFORE UPDATE ON preview_report_generation_snapshots
BEGIN SELECT RAISE(ABORT,'generation snapshots are append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_generation_snapshot_delete_guard BEFORE DELETE ON preview_report_generation_snapshots
BEGIN SELECT RAISE(ABORT,'generation snapshots are append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_feedback_insert_guard
BEFORE INSERT ON preview_report_feedback
WHEN NOT EXISTS (
  SELECT 1 FROM preview_report_generation_snapshots s JOIN preview_cases c ON c.id=s.case_id
  JOIN preview_case_assignments a ON a.case_id=s.case_id AND a.user_id=NEW.created_by
  JOIN preview_users u ON u.id=NEW.created_by
  WHERE s.generation_id=NEW.generation_id AND s.organization_id=NEW.organization_id AND s.case_id=NEW.case_id
    AND s.prompt_id=NEW.prompt_id AND s.chapter_code=NEW.chapter_code AND s.output_sha256=NEW.ai_output_sha256
    AND c.organization_id=NEW.organization_id AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'feedback must match an assigned server generation'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_feedback_update_guard BEFORE UPDATE ON preview_report_feedback
BEGIN SELECT RAISE(ABORT,'report feedback is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_feedback_delete_guard BEFORE DELETE ON preview_report_feedback
BEGIN SELECT RAISE(ABORT,'report feedback is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_candidate_insert_guard
BEFORE INSERT ON preview_memory_candidates
WHEN NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM preview_report_feedback f WHERE f.id=NEW.feedback_id AND f.organization_id=NEW.organization_id AND f.created_by=NEW.created_by)
BEGIN SELECT RAISE(ABORT,'memory candidates start pending from an immutable feedback row'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_candidate_update_guard
BEFORE UPDATE ON preview_memory_candidates
WHEN NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.feedback_id<>OLD.feedback_id
  OR NEW.memory_scope<>OLD.memory_scope OR NEW.scope_key<>OLD.scope_key OR NEW.problem_text<>OLD.problem_text
  OR NEW.rule_text<>OLD.rule_text OR NEW.tags_json<>OLD.tags_json OR NEW.analyzer_code<>OLD.analyzer_code
  OR NEW.confidence<>OLD.confidence OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
  OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('ACTIVE','REJECTED','DISABLED')
  OR (OLD.status='PENDING' AND NEW.status NOT IN ('ACTIVE','REJECTED'))
  OR (OLD.status='ACTIVE' AND NEW.status<>'DISABLED') OR OLD.status IN ('REJECTED','DISABLED')
  OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
  OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.reviewed_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0)
BEGIN SELECT RAISE(ABORT,'memory transition requires active Admin and optimistic version'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_candidate_delete_guard BEFORE DELETE ON preview_memory_candidates
BEGIN SELECT RAISE(ABORT,'memory candidates cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_usage_insert_guard
BEFORE INSERT ON preview_memory_usage
WHEN NOT EXISTS (SELECT 1 FROM preview_memory_candidates m WHERE m.id=NEW.memory_id AND m.status='ACTIVE')
  OR NOT EXISTS (SELECT 1 FROM preview_report_generation_snapshots s WHERE s.generation_id=NEW.generation_id)
BEGIN SELECT RAISE(ABORT,'only active memory may be linked to a generation'); END;
CREATE TRIGGER IF NOT EXISTS preview_memory_usage_update_guard BEFORE UPDATE ON preview_memory_usage
BEGIN SELECT RAISE(ABORT,'memory usage is append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_memory_usage_delete_guard BEFORE DELETE ON preview_memory_usage
BEGIN SELECT RAISE(ABORT,'memory usage is append-only'); END;

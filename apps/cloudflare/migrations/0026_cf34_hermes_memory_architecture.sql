-- CF34: scoped short/long-term memory retrieval with immutable usage evidence.

CREATE TABLE IF NOT EXISTS preview_memory_retrieval_runs (
  generation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL CHECK (organization_id='concost'),
  case_id TEXT NOT NULL,
  chapter_code TEXT NOT NULL CHECK (length(chapter_code) BETWEEN 3 AND 32),
  actor_id TEXT NOT NULL,
  engine_code TEXT NOT NULL CHECK (engine_code='D1_HERMES_COMPATIBLE_V2'),
  short_term_sha256 TEXT NOT NULL CHECK (length(short_term_sha256)=64),
  short_term_items INTEGER NOT NULL CHECK (short_term_items BETWEEN 0 AND 16),
  long_term_items INTEGER NOT NULL CHECK (long_term_items BETWEEN 0 AND 8),
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (generation_id) REFERENCES preview_report_generation_snapshots(generation_id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_memory_retrieval_case
  ON preview_memory_retrieval_runs(case_id,created_at DESC);

DROP TRIGGER IF EXISTS preview_memory_candidate_insert_guard;
CREATE TRIGGER preview_memory_candidate_insert_guard
BEFORE INSERT ON preview_memory_candidates
WHEN NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM preview_report_feedback f
    JOIN preview_cases c ON c.id=f.case_id AND c.organization_id=f.organization_id
    WHERE f.id=NEW.feedback_id AND f.organization_id=NEW.organization_id AND f.created_by=NEW.created_by
      AND (
        (NEW.memory_scope='GLOBAL' AND NEW.scope_key=NEW.organization_id)
        OR (NEW.memory_scope='REPORT_TYPE' AND NEW.scope_key=c.claim_type||':REPORT')
        OR (NEW.memory_scope='CLAIM_TYPE' AND NEW.scope_key=c.claim_type)
        OR (NEW.memory_scope='CHAPTER' AND NEW.scope_key=c.claim_type||':'||f.chapter_code)
        OR (NEW.memory_scope='USER_FEEDBACK' AND NEW.scope_key=f.created_by)
      )
  )
BEGIN SELECT RAISE(ABORT,'memory candidate scope must match its immutable feedback provenance'); END;

DROP TRIGGER IF EXISTS preview_memory_usage_insert_guard;
CREATE TRIGGER preview_memory_usage_insert_guard
BEFORE INSERT ON preview_memory_usage
WHEN NOT EXISTS (
  SELECT 1
  FROM preview_memory_candidates m
  JOIN preview_report_feedback f ON f.id=m.feedback_id AND f.organization_id=m.organization_id
  JOIN preview_report_generation_snapshots s ON s.generation_id=NEW.generation_id AND s.organization_id=m.organization_id
  JOIN preview_cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
  WHERE m.id=NEW.memory_id AND m.status='ACTIVE'
    AND (
      (m.memory_scope='GLOBAL' AND m.scope_key=m.organization_id)
      OR (m.memory_scope='REPORT_TYPE' AND m.scope_key=c.claim_type||':REPORT')
      OR (m.memory_scope='CLAIM_TYPE' AND m.scope_key=c.claim_type)
      OR (m.memory_scope='CHAPTER' AND m.scope_key=c.claim_type||':'||s.chapter_code)
      OR (m.memory_scope='USER_FEEDBACK' AND m.scope_key=s.created_by)
    )
)
BEGIN SELECT RAISE(ABORT,'memory usage must match the generation actor and report scope'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_retrieval_insert_guard
BEFORE INSERT ON preview_memory_retrieval_runs
WHEN NOT EXISTS (
  SELECT 1 FROM preview_report_generation_snapshots s
  JOIN preview_cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
  JOIN preview_users u ON u.id=s.created_by AND u.is_active=1
  JOIN preview_case_assignments a ON a.case_id=s.case_id AND a.user_id=s.created_by
  WHERE s.generation_id=NEW.generation_id AND s.organization_id=NEW.organization_id
    AND s.case_id=NEW.case_id AND s.chapter_code=NEW.chapter_code AND s.created_by=NEW.actor_id
)
BEGIN SELECT RAISE(ABORT,'memory retrieval evidence must match an assigned generation actor'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_retrieval_update_guard
BEFORE UPDATE ON preview_memory_retrieval_runs
BEGIN SELECT RAISE(ABORT,'memory retrieval evidence is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_memory_retrieval_delete_guard
BEFORE DELETE ON preview_memory_retrieval_runs
BEGIN SELECT RAISE(ABORT,'memory retrieval evidence is append-only'); END;

-- CF18: project-specific report outline planning. The approved template remains
-- authoritative; writers can add chapter planning notes and explicitly confirm
-- the exact prompt version set before AI authoring begins.

CREATE TABLE IF NOT EXISTS preview_report_outline_plans (
  case_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  claim_type TEXT NOT NULL,
  outline_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
  CHECK (json_valid(outline_json) AND json_type(outline_json) = 'array'),
  CHECK (json_array_length(outline_json) BETWEEN 1 AND 20),
  CHECK (status IN ('DRAFT','CONFIRMED')),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TRIGGER IF NOT EXISTS preview_report_outline_insert_guard
BEFORE INSERT ON preview_report_outline_plans
BEGIN
  SELECT RAISE(ABORT, 'report outline scope is invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id = NEW.updated_by
    WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id
      AND c.claim_type = NEW.claim_type AND c.deleted_at IS NULL AND u.is_active = 1
      AND (
        EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = 'admin')
        OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = c.id AND a.user_id = u.id)
      )
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff'))
  );
  SELECT RAISE(ABORT, 'report outline must match the approved template')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.outline_json) item
    WHERE json_type(item.value) <> 'object'
      OR json_type(item.value, '$.chapterId') <> 'text'
      OR json_type(item.value, '$.chapterCode') <> 'text'
      OR json_type(item.value, '$.promptVersion') <> 'integer'
      OR json_type(item.value, '$.planningNote') <> 'text'
      OR length(json_extract(item.value, '$.planningNote')) > 2000
      OR NOT EXISTS (
        SELECT 1 FROM preview_report_chapter_prompts p
        JOIN preview_report_prompt_sets s ON s.id = p.prompt_set_id
        WHERE p.id = json_extract(item.value, '$.chapterId')
          AND p.chapter_code = json_extract(item.value, '$.chapterCode')
          AND p.version = json_extract(item.value, '$.promptVersion')
          AND s.organization_id = NEW.organization_id
          AND s.claim_type = NEW.claim_type
          AND s.status = 'ACTIVE'
      )
  );
  SELECT RAISE(ABORT, 'report outline contains duplicate chapters')
  WHERE (SELECT COUNT(*) FROM json_each(NEW.outline_json)) <>
        (SELECT COUNT(DISTINCT json_extract(value, '$.chapterId')) FROM json_each(NEW.outline_json));
  SELECT RAISE(ABORT, 'report outline omits an approved chapter')
  WHERE (SELECT COUNT(*) FROM json_each(NEW.outline_json)) <> (
    SELECT COUNT(*) FROM preview_report_chapter_prompts p
    JOIN preview_report_prompt_sets s ON s.id = p.prompt_set_id
    WHERE s.organization_id = NEW.organization_id AND s.claim_type = NEW.claim_type AND s.status = 'ACTIVE'
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_report_outline_update_guard
BEFORE UPDATE ON preview_report_outline_plans
BEGIN
  SELECT RAISE(ABORT, 'report outline identity or version is invalid')
  WHERE NEW.case_id <> OLD.case_id OR NEW.organization_id <> OLD.organization_id
    OR NEW.claim_type <> OLD.claim_type OR NEW.created_at <> OLD.created_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at;
  SELECT RAISE(ABORT, 'report outline editor is not allowed')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id = NEW.updated_by AND u.is_active = 1
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff'))
      AND (
        EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = 'admin')
        OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id = NEW.case_id AND a.user_id = u.id)
      )
  );
  SELECT RAISE(ABORT, 'confirmed report outline cannot return to draft')
  WHERE OLD.status = 'CONFIRMED' AND NEW.status = 'DRAFT';
  SELECT RAISE(ABORT, 'report outline must match the approved template')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.outline_json) item
    WHERE json_type(item.value) <> 'object'
      OR json_type(item.value, '$.chapterId') <> 'text'
      OR json_type(item.value, '$.chapterCode') <> 'text'
      OR json_type(item.value, '$.promptVersion') <> 'integer'
      OR json_type(item.value, '$.planningNote') <> 'text'
      OR length(json_extract(item.value, '$.planningNote')) > 2000
      OR NOT EXISTS (
        SELECT 1 FROM preview_report_chapter_prompts p
        JOIN preview_report_prompt_sets s ON s.id = p.prompt_set_id
        WHERE p.id = json_extract(item.value, '$.chapterId')
          AND p.chapter_code = json_extract(item.value, '$.chapterCode')
          AND p.version = json_extract(item.value, '$.promptVersion')
          AND s.organization_id = NEW.organization_id
          AND s.claim_type = NEW.claim_type
          AND s.status = 'ACTIVE'
      )
  );
  SELECT RAISE(ABORT, 'report outline contains duplicate chapters')
  WHERE (SELECT COUNT(*) FROM json_each(NEW.outline_json)) <>
        (SELECT COUNT(DISTINCT json_extract(value, '$.chapterId')) FROM json_each(NEW.outline_json));
  SELECT RAISE(ABORT, 'report outline omits an approved chapter')
  WHERE (SELECT COUNT(*) FROM json_each(NEW.outline_json)) <> (
    SELECT COUNT(*) FROM preview_report_chapter_prompts p
    JOIN preview_report_prompt_sets s ON s.id = p.prompt_set_id
    WHERE s.organization_id = NEW.organization_id AND s.claim_type = NEW.claim_type AND s.status = 'ACTIVE'
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_report_outline_delete_guard
BEFORE DELETE ON preview_report_outline_plans
BEGIN
  SELECT RAISE(ABORT, 'report outline plans cannot be deleted');
END;


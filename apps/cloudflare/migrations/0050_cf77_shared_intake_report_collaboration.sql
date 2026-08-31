-- CF77: organization-wide intake collaboration, chapter-owned report review,
-- and recoverable project-schedule visibility. Existing business rows are not
-- rewritten or deleted by this migration.

CREATE TABLE IF NOT EXISTS preview_report_chapter_assignments (
  case_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  chapter_id TEXT NOT NULL,
  chapter_code TEXT NOT NULL,
  chapter_title TEXT NOT NULL,
  assignee_id TEXT,
  status TEXT NOT NULL DEFAULT 'UNASSIGNED',
  draft_text TEXT NOT NULL DEFAULT '',
  draft_editor_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  assigned_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (case_id, chapter_id),
  CHECK (organization_id = 'concost'),
  CHECK (length(chapter_id) BETWEEN 1 AND 100),
  CHECK (length(chapter_code) BETWEEN 1 AND 50),
  CHECK (length(chapter_title) BETWEEN 1 AND 300),
  CHECK (status IN ('UNASSIGNED','IN_PROGRESS','READY','APPLIED')),
  CHECK (length(draft_text) <= 200000),
  CHECK (draft_editor_json IS NULL OR json_valid(draft_editor_json)),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (assignee_id) REFERENCES preview_users(id),
  FOREIGN KEY (assigned_by) REFERENCES preview_users(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_chapter_assignee
  ON preview_report_chapter_assignments (organization_id, assignee_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS preview_report_chapter_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  draft_text TEXT NOT NULL,
  draft_editor_json TEXT,
  content_sha256 TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (version >= 1),
  CHECK (status IN ('UNASSIGNED','IN_PROGRESS','READY','APPLIED')),
  CHECK (length(draft_text) <= 200000),
  CHECK (draft_editor_json IS NULL OR json_valid(draft_editor_json)),
  CHECK (length(content_sha256) = 64),
  FOREIGN KEY (case_id, chapter_id) REFERENCES preview_report_chapter_assignments(case_id, chapter_id),
  FOREIGN KEY (saved_by) REFERENCES preview_users(id),
  UNIQUE (case_id, chapter_id, version)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_chapter_revisions
  ON preview_report_chapter_revisions (case_id, chapter_id, version DESC);

CREATE TABLE IF NOT EXISTS preview_project_schedule_visibility (
  case_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  visibility TEXT NOT NULL DEFAULT 'ACTIVE',
  reason_code TEXT,
  reason_text TEXT,
  drive_verified INTEGER NOT NULL DEFAULT 0,
  manifest_sha256 TEXT,
  verification_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (visibility IN ('ACTIVE','HIDDEN')),
  CHECK (reason_code IS NULL OR reason_code IN ('CANCELLED','DELIVERED_ARCHIVED')),
  CHECK (reason_text IS NULL OR length(reason_text) BETWEEN 2 AND 1000),
  CHECK (drive_verified IN (0,1)),
  CHECK (manifest_sha256 IS NULL OR length(manifest_sha256) = 64),
  CHECK (json_valid(verification_json)),
  CHECK (version >= 1),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_project_schedule_visibility_events (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  from_visibility TEXT NOT NULL,
  to_visibility TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  drive_verified INTEGER NOT NULL,
  manifest_sha256 TEXT,
  verification_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (from_visibility IN ('ACTIVE','HIDDEN')),
  CHECK (to_visibility IN ('ACTIVE','HIDDEN')),
  CHECK (reason_code IN ('CANCELLED','DELIVERED_ARCHIVED')),
  CHECK (length(reason_text) BETWEEN 2 AND 1000),
  CHECK (drive_verified IN (0,1)),
  CHECK (manifest_sha256 IS NULL OR length(manifest_sha256) = 64),
  CHECK (json_valid(verification_json)),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_project_schedule_visibility_events
  ON preview_project_schedule_visibility_events (case_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_report_chapter_assignment_insert_guard
BEFORE INSERT ON preview_report_chapter_assignments
WHEN NEW.assigned_by <> NEW.updated_by
  OR NOT EXISTS (
    SELECT 1 FROM preview_cases c
    JOIN preview_users actor ON actor.id=NEW.assigned_by AND actor.is_active=1
    LEFT JOIN preview_project_schedule_profiles profile ON profile.case_id=c.id AND profile.organization_id=c.organization_id
    WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
      AND (EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value)='admin') OR profile.responsible_pm_id=actor.id)
  )
  OR (NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM preview_users assignee
    WHERE assignee.id=NEW.assignee_id AND assignee.is_active=1
      AND EXISTS (SELECT 1 FROM json_each(assignee.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm','staff','reviewer'))
  ))
BEGIN SELECT RAISE(ABORT, 'report chapter assignment actor or assignee is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_chapter_assignment_update_guard
BEFORE UPDATE ON preview_report_chapter_assignments
WHEN NEW.case_id <> OLD.case_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.chapter_id <> OLD.chapter_id
  OR NEW.chapter_code <> OLD.chapter_code
  OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1
  OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1)
  OR (
    COALESCE(NEW.assignee_id,'') <> COALESCE(OLD.assignee_id,'')
    AND NOT EXISTS (
      SELECT 1 FROM preview_users actor
      LEFT JOIN preview_project_schedule_profiles profile ON profile.case_id=OLD.case_id AND profile.organization_id=OLD.organization_id
      WHERE actor.id=NEW.updated_by AND actor.is_active=1
        AND (EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value)='admin') OR profile.responsible_pm_id=actor.id)
    )
  )
  OR (
    COALESCE(NEW.assignee_id,'') = COALESCE(OLD.assignee_id,'')
    AND NEW.updated_by <> COALESCE(OLD.assignee_id,'')
    AND NOT EXISTS (
      SELECT 1 FROM preview_users actor
      LEFT JOIN preview_project_schedule_profiles profile ON profile.case_id=OLD.case_id AND profile.organization_id=OLD.organization_id
      WHERE actor.id=NEW.updated_by AND actor.is_active=1
        AND (EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value)='admin') OR profile.responsible_pm_id=actor.id)
    )
  )
  OR (NEW.status='APPLIED' AND NOT EXISTS (
    SELECT 1 FROM preview_users actor
    LEFT JOIN preview_project_schedule_profiles profile ON profile.case_id=OLD.case_id AND profile.organization_id=OLD.organization_id
    WHERE actor.id=NEW.updated_by AND actor.is_active=1
      AND (EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value)='admin') OR profile.responsible_pm_id=actor.id)
  ))
BEGIN SELECT RAISE(ABORT, 'report chapter assignment update is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_chapter_assignment_delete_guard
BEFORE DELETE ON preview_report_chapter_assignments
BEGIN SELECT RAISE(ABORT, 'report chapter assignment cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_chapter_revision_insert_guard
BEFORE INSERT ON preview_report_chapter_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM preview_report_chapter_assignments a
  WHERE a.case_id=NEW.case_id AND a.chapter_id=NEW.chapter_id
    AND a.version=NEW.version AND a.status=NEW.status AND a.draft_text=NEW.draft_text
    AND COALESCE(a.draft_editor_json,'')=COALESCE(NEW.draft_editor_json,'')
    AND a.updated_by=NEW.saved_by AND a.updated_at=NEW.saved_at
)
BEGIN SELECT RAISE(ABORT, 'report chapter revision does not match the canonical assignment'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_chapter_revision_update_guard
BEFORE UPDATE ON preview_report_chapter_revisions
BEGIN SELECT RAISE(ABORT, 'report chapter revision is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_report_chapter_revision_delete_guard
BEFORE DELETE ON preview_report_chapter_revisions
BEGIN SELECT RAISE(ABORT, 'report chapter revision is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_project_schedule_visibility_insert_guard
BEFORE INSERT ON preview_project_schedule_visibility
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c
  JOIN preview_users actor ON actor.id=NEW.updated_by AND actor.is_active=1
  LEFT JOIN preview_project_schedule_profiles profile ON profile.case_id=c.id AND profile.organization_id=c.organization_id
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value)='admin') OR profile.responsible_pm_id=actor.id)
)
  OR (NEW.reason_code='DELIVERED_ARCHIVED' AND (NEW.drive_verified<>1 OR NEW.manifest_sha256 IS NULL))
BEGIN SELECT RAISE(ABORT, 'project schedule visibility actor or archive manifest is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_project_schedule_visibility_update_guard
BEFORE UPDATE ON preview_project_schedule_visibility
WHEN NEW.case_id <> OLD.case_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.created_at <> OLD.created_at
  OR NEW.version <> OLD.version + 1
  OR NEW.updated_at <= OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_cases c
    JOIN preview_users actor ON actor.id=NEW.updated_by AND actor.is_active=1
    LEFT JOIN preview_project_schedule_profiles profile ON profile.case_id=c.id AND profile.organization_id=c.organization_id
    WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id
      AND (EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value)='admin') OR profile.responsible_pm_id=actor.id)
  )
  OR (NEW.reason_code='DELIVERED_ARCHIVED' AND (NEW.drive_verified<>1 OR NEW.manifest_sha256 IS NULL))
BEGIN SELECT RAISE(ABORT, 'project schedule visibility update is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_project_schedule_visibility_delete_guard
BEFORE DELETE ON preview_project_schedule_visibility
BEGIN SELECT RAISE(ABORT, 'project schedule visibility cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_project_schedule_visibility_event_update_guard
BEFORE UPDATE ON preview_project_schedule_visibility_events
BEGIN SELECT RAISE(ABORT, 'project schedule visibility event is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_project_schedule_visibility_event_delete_guard
BEFORE DELETE ON preview_project_schedule_visibility_events
BEGIN SELECT RAISE(ABORT, 'project schedule visibility event is append-only'); END;

-- Proposal authoring and snapshot linking are shared by active operational
-- members until reception. Award decisions stay restricted to manager roles.
DROP TRIGGER IF EXISTS preview_proposal_insert_guard;
CREATE TRIGGER preview_proposal_insert_guard
BEFORE INSERT ON preview_proposals
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id
    AND c.deleted_at IS NULL AND u.is_active=1
    AND c.status IN ('INQUIRY','PROPOSAL','ESTIMATE')
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm','staff'))
)
BEGIN SELECT RAISE(ABORT,'proposal author scope is invalid'); END;

DROP TRIGGER IF EXISTS preview_proposal_link_insert_guard;
CREATE TRIGGER preview_proposal_link_insert_guard
BEFORE INSERT ON preview_proposal_links
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c
  JOIN preview_users u ON u.id=NEW.created_by AND u.is_active=1
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id
    AND c.deleted_at IS NULL AND c.status IN ('INQUIRY','PROPOSAL','ESTIMATE')
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm','staff'))
)
BEGIN SELECT RAISE(ABORT, 'proposal link actor or case scope is invalid'); END;

DROP TRIGGER IF EXISTS preview_award_decision_insert_guard;
CREATE TRIGGER preview_award_decision_insert_guard
BEFORE INSERT ON preview_award_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM preview_proposal_links p
  JOIN preview_cases c ON c.id=p.case_id AND c.organization_id=p.organization_id AND c.deleted_at IS NULL
  JOIN preview_users u ON u.id=NEW.decided_by AND u.is_active=1
  WHERE p.id=NEW.proposal_link_id AND p.case_id=NEW.case_id
    AND p.award_status='PENDING' AND p.version=NEW.expected_link_version
    AND c.status IN ('INQUIRY','PROPOSAL','ESTIMATE')
    AND EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm'))
    AND (
      EXISTS (SELECT 1 FROM json_each(u.roles_json) r WHERE lower(r.value)='admin')
      OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=u.id)
    )
)
BEGIN SELECT RAISE(ABORT, 'award decision actor, case, or version is invalid'); END;

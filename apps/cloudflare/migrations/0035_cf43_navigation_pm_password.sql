-- CF43: fixed responsible-PM roster and persistent Admin account availability.

UPDATE preview_users
SET is_active = 1,
    roles_json = CASE
      WHEN EXISTS (SELECT 1 FROM json_each(preview_users.roles_json) WHERE lower(value)='admin') THEN roles_json
      ELSE json_insert(roles_json,'$[#]','admin')
    END,
    version = version + 1
WHERE login_id='yjw@con-cost.com' COLLATE NOCASE
  AND (is_active<>1 OR NOT EXISTS (SELECT 1 FROM json_each(preview_users.roles_json) WHERE lower(value)='admin'));

DROP TRIGGER preview_schedule_profile_insert_guard;
CREATE TRIGGER preview_schedule_profile_insert_guard BEFORE INSERT ON preview_project_schedule_profiles
WHEN NOT EXISTS (
  SELECT 1 FROM preview_cases c
  JOIN preview_users pm ON pm.id=NEW.responsible_pm_id AND pm.is_active=1
  JOIN preview_users actor ON actor.id=NEW.updated_by AND actor.is_active=1
  WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
    AND pm.display_name IN ('현동명','이원희','이경훈','최영배','장범선')
    AND EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=c.id AND a.user_id=pm.id)
    AND EXISTS (SELECT 1 FROM json_each(actor.roles_json) r WHERE lower(r.value) IN ('admin','ceo','director','pm'))
) BEGIN SELECT RAISE(ABORT,'schedule profile requires one of the five approved PMs'); END;

DROP TRIGGER preview_schedule_profile_update_guard;
CREATE TRIGGER preview_schedule_profile_update_guard BEFORE UPDATE ON preview_project_schedule_profiles
WHEN NEW.case_id<>OLD.case_id OR NEW.organization_id<>OLD.organization_id OR NEW.created_at<>OLD.created_at
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users pm JOIN preview_case_assignments a ON a.user_id=pm.id AND a.case_id=NEW.case_id
    WHERE pm.id=NEW.responsible_pm_id AND pm.is_active=1
      AND pm.display_name IN ('현동명','이원희','이경훈','최영배','장범선')
  )
BEGIN SELECT RAISE(ABORT,'schedule profile update requires one of the five approved PMs'); END;

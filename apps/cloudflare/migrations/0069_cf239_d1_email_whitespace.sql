-- D1 limits LIKE/GLOB patterns to 50 bytes. The Unicode whitespace character
-- class in 0068 exceeds that limit. Keep the same address policy using instr
-- rather than a pattern; preserve every existing account and outbox row.
DROP TRIGGER preview_email_outbox_insert_guard;
CREATE TRIGGER preview_email_outbox_insert_guard BEFORE INSERT ON preview_email_outbox
WHEN NOT EXISTS (
  SELECT 1 FROM preview_notifications n JOIN preview_users u ON u.id=NEW.recipient_user_id
  WHERE n.id=NEW.notification_id AND n.user_id=NEW.recipient_user_id AND u.is_active=1
    AND n.organization_id=NEW.organization_id
    AND lower(NEW.recipient_email)=lower(CASE
      WHEN u.email LIKE '%_@_%._%' AND length(u.email)-length(replace(u.email,'@',''))=1
        AND NOT EXISTS (SELECT 1 FROM json_each('[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]') w WHERE instr(u.email,char(w.value))>0) THEN u.email
      WHEN u.login_id LIKE '%_@_%._%' AND length(u.login_id)-length(replace(u.login_id,'@',''))=1
        AND NOT EXISTS (SELECT 1 FROM json_each('[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]') w WHERE instr(u.login_id,char(w.value))>0) THEN u.login_id
      ELSE NULL END)
)
BEGIN SELECT RAISE(ABORT,'email outbox recipient is invalid'); END;

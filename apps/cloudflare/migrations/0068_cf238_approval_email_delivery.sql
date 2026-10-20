-- Keep account data intact. A mail-shaped login ID is a fallback only when the
-- same active recipient has no mail-shaped contact address.
DROP TRIGGER IF EXISTS preview_email_outbox_insert_guard;
CREATE TRIGGER preview_email_outbox_insert_guard BEFORE INSERT ON preview_email_outbox
WHEN NOT EXISTS (
  SELECT 1 FROM preview_notifications n JOIN preview_users u ON u.id=NEW.recipient_user_id
  WHERE n.id=NEW.notification_id AND n.user_id=NEW.recipient_user_id AND u.is_active=1
    AND n.organization_id=NEW.organization_id
    AND lower(NEW.recipient_email)=lower(CASE
      WHEN u.email LIKE '%_@_%._%' AND length(u.email)-length(replace(u.email,'@',''))=1
        AND u.email NOT GLOB ('*['||char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)||']*') THEN u.email
      WHEN u.login_id LIKE '%_@_%._%' AND length(u.login_id)-length(replace(u.login_id,'@',''))=1
        AND u.login_id NOT GLOB ('*['||char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)||']*') THEN u.login_id
      ELSE NULL END)
)
BEGIN SELECT RAISE(ABORT,'email outbox recipient is invalid'); END;

-- A durable per-message claim prevents overlapping sends. An unknown network
-- result retains the claim: retrying blindly could deliver a duplicate mail.
CREATE TABLE IF NOT EXISTS preview_email_dispatch_claims (
  outbox_id TEXT PRIMARY KEY REFERENCES preview_email_outbox(id),
  claim_token TEXT NOT NULL CHECK (length(claim_token)=36),
  started_at TEXT NOT NULL
);

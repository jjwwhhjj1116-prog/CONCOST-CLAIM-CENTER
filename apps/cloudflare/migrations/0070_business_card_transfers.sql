-- Short-lived, encrypted phone-to-PC transfers. Registered cards and their Drive originals are unchanged.
CREATE TABLE IF NOT EXISTS preview_business_card_transfers (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES preview_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','UPLOADED')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uploaded_at TEXT,
  upload_nonce TEXT
);
CREATE INDEX IF NOT EXISTS idx_preview_business_card_transfers_actor ON preview_business_card_transfers(actor_id, expires_at);
CREATE TABLE IF NOT EXISTS preview_business_card_transfer_images (
  token_hash TEXT NOT NULL REFERENCES preview_business_card_transfers(token_hash) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK(side IN ('front','back')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  PRIMARY KEY(token_hash, side)
);

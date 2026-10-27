-- Additive storage for two-sided cards; existing single-sided rows stay unchanged.
CREATE TABLE IF NOT EXISTS preview_business_card_analysis_backs (
  analysis_id TEXT PRIMARY KEY REFERENCES preview_business_card_analyses(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10000000),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256)=64)
);
CREATE TABLE IF NOT EXISTS preview_business_card_backs (
  card_id TEXT PRIMARY KEY REFERENCES preview_business_cards(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10000000),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256)=64),
  google_file_id TEXT NOT NULL,
  google_drive_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preview_business_card_operation_files (
  operation_id TEXT NOT NULL REFERENCES preview_business_card_operations(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('front','back')),
  google_file_id TEXT NOT NULL,
  PRIMARY KEY (operation_id, side)
);
CREATE TABLE IF NOT EXISTS preview_business_card_analysis_locks (
  analysis_id TEXT PRIMARY KEY REFERENCES preview_business_card_analyses(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE REFERENCES preview_business_card_operations(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS preview_business_card_source_locks (
  organization_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256)=64),
  operation_id TEXT NOT NULL UNIQUE REFERENCES preview_business_card_operations(id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, source_sha256)
);
CREATE TRIGGER IF NOT EXISTS preview_business_card_backs_insert_guard BEFORE INSERT ON preview_business_card_backs
WHEN length(trim(NEW.google_file_id)) < 10 OR NOT EXISTS (
  SELECT 1 FROM preview_business_cards c JOIN preview_business_card_analysis_backs a ON a.analysis_id=c.analysis_id
  WHERE c.id=NEW.card_id AND a.source_sha256=NEW.source_sha256 AND a.mime_type=NEW.mime_type AND a.byte_size=NEW.byte_size AND a.original_name=NEW.original_name
) BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_BACK_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS preview_business_card_backs_immutable_update BEFORE UPDATE ON preview_business_card_backs BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS preview_business_card_backs_immutable_delete BEFORE DELETE ON preview_business_card_backs BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS preview_business_card_analysis_backs_immutable_update BEFORE UPDATE ON preview_business_card_analysis_backs BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_ANALYSIS_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS preview_business_card_analysis_backs_immutable_delete BEFORE DELETE ON preview_business_card_analysis_backs BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_ANALYSIS_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS preview_business_card_operation_files_immutable_update BEFORE UPDATE ON preview_business_card_operation_files BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_OPERATION_FILE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS preview_business_card_operation_files_immutable_delete BEFORE DELETE ON preview_business_card_operation_files BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_OPERATION_FILE_IMMUTABLE'); END;

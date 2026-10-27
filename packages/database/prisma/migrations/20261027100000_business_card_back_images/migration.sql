-- Additive parity for two-sided business cards.
CREATE TABLE IF NOT EXISTS "BusinessCardAnalysisBack" (
  "analysisId" TEXT NOT NULL PRIMARY KEY REFERENCES "BusinessCardAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL CHECK ("mimeType" IN ('image/jpeg','image/png','image/webp')),
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" > 0 AND "byteSize" <= 10000000),
  "sourceSha256" TEXT NOT NULL CHECK (length("sourceSha256")=64)
);
CREATE TABLE IF NOT EXISTS "BusinessCardBack" (
  "cardId" TEXT NOT NULL PRIMARY KEY REFERENCES "BusinessCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL CHECK ("mimeType" IN ('image/jpeg','image/png','image/webp')),
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" > 0 AND "byteSize" <= 10000000),
  "sourceSha256" TEXT NOT NULL CHECK (length("sourceSha256")=64),
  "googleFileId" TEXT NOT NULL,
  "googleDriveUrl" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "BusinessCardOperationFile" (
  "operationId" TEXT NOT NULL REFERENCES "BusinessCardOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "side" TEXT NOT NULL CHECK ("side" IN ('front','back')),
  "googleFileId" TEXT NOT NULL,
  PRIMARY KEY ("operationId", "side")
);
CREATE TABLE IF NOT EXISTS "BusinessCardAnalysisLock" (
  "analysisId" TEXT NOT NULL PRIMARY KEY REFERENCES "BusinessCardAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operationId" TEXT NOT NULL UNIQUE REFERENCES "BusinessCardOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "BusinessCardSourceLock" (
  "organizationId" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL CHECK (length("sourceSha256")=64),
  "operationId" TEXT NOT NULL UNIQUE REFERENCES "BusinessCardOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("organizationId", "sourceSha256")
);
CREATE TRIGGER IF NOT EXISTS BusinessCardBack_insert_guard BEFORE INSERT ON "BusinessCardBack"
WHEN length(trim(NEW."googleFileId")) < 10 OR NOT EXISTS (
  SELECT 1 FROM "BusinessCard" c JOIN "BusinessCardAnalysisBack" a ON a."analysisId"=c."analysisId"
  WHERE c."id"=NEW."cardId" AND a."sourceSha256"=NEW."sourceSha256" AND a."mimeType"=NEW."mimeType" AND a."byteSize"=NEW."byteSize" AND a."originalName"=NEW."originalName"
) BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_BACK_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS BusinessCardBack_immutable_update BEFORE UPDATE ON "BusinessCardBack" BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS BusinessCardBack_immutable_delete BEFORE DELETE ON "BusinessCardBack" BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS BusinessCardAnalysisBack_immutable_update BEFORE UPDATE ON "BusinessCardAnalysisBack" BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_ANALYSIS_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS BusinessCardAnalysisBack_immutable_delete BEFORE DELETE ON "BusinessCardAnalysisBack" BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_ANALYSIS_BACK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS BusinessCardOperationFile_immutable_update BEFORE UPDATE ON "BusinessCardOperationFile" BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_OPERATION_FILE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS BusinessCardOperationFile_immutable_delete BEFORE DELETE ON "BusinessCardOperationFile" BEGIN SELECT RAISE(ABORT, 'BUSINESS_CARD_OPERATION_FILE_IMMUTABLE'); END;

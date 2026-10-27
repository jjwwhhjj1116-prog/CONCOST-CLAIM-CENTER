-- Additive SQLite parity for encrypted, temporary phone-to-PC transfers.
CREATE TABLE IF NOT EXISTS "BusinessCardTransfer" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK("status" IN ('PENDING','UPLOADED')),
  "createdAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "uploadedAt" DATETIME,
  "uploadNonce" TEXT,
  CONSTRAINT "BusinessCardTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCardTransfer_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BusinessCardTransfer_actorId_expiresAt_idx" ON "BusinessCardTransfer"("actorId", "expiresAt");
CREATE TABLE IF NOT EXISTS "BusinessCardTransferImage" (
  "tokenHash" TEXT NOT NULL,
  "side" TEXT NOT NULL CHECK("side" IN ('front','back')),
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL CHECK("mimeType" IN ('image/jpeg','image/png','image/webp')),
  PRIMARY KEY("tokenHash", "side"),
  CONSTRAINT "BusinessCardTransferImage_tokenHash_fkey" FOREIGN KEY ("tokenHash") REFERENCES "BusinessCardTransfer" ("tokenHash") ON DELETE CASCADE ON UPDATE CASCADE
);

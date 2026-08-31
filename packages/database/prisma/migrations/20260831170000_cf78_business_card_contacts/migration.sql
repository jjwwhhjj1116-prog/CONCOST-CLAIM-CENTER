-- Additive SQLite parity for CF78. Existing project and report rows are not changed.

CREATE TABLE "BusinessCardAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "geminiModelCode" TEXT NOT NULL,
  "geminiCredentialSource" TEXT NOT NULL,
  "extractedJson" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  CONSTRAINT "BusinessCardAnalysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCardAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BusinessCardAnalysis_createdById_expiresAt_consumedAt_idx" ON "BusinessCardAnalysis"("createdById", "expiresAt", "consumedAt");

CREATE TABLE "BusinessCardOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "cardId" TEXT,
  "googleFileId" TEXT,
  "errorCode" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BusinessCardOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCardOperation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BusinessCardOperation_organizationId_idempotencyKey_key" ON "BusinessCardOperation"("organizationId", "idempotencyKey");
CREATE INDEX "BusinessCardOperation_organizationId_status_updatedAt_idx" ON "BusinessCardOperation"("organizationId", "status", "updatedAt");

CREATE TABLE "BusinessCard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "department" TEXT,
  "title" TEXT,
  "mobile" TEXT,
  "phone" TEXT,
  "fax" TEXT,
  "email" TEXT,
  "address" TEXT,
  "website" TEXT,
  "notes" TEXT,
  "tagsText" TEXT,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "googleFileId" TEXT NOT NULL,
  "googleFolderId" TEXT NOT NULL,
  "googleDriveUrl" TEXT NOT NULL,
  "geminiModelCode" TEXT NOT NULL,
  "geminiCredentialSource" TEXT NOT NULL,
  "extractedJson" TEXT NOT NULL,
  "reviewConfirmed" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "deletedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME,
  CONSTRAINT "BusinessCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCard_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "BusinessCardAnalysis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCard_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCard_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BusinessCard_analysisId_key" ON "BusinessCard"("analysisId");
CREATE INDEX "BusinessCard_organizationId_deletedAt_name_company_department_idx" ON "BusinessCard"("organizationId", "deletedAt", "name", "company", "department");
CREATE INDEX "BusinessCard_createdById_createdAt_idx" ON "BusinessCard"("createdById", "createdAt");
CREATE INDEX "BusinessCard_organizationId_sourceSha256_deletedAt_idx" ON "BusinessCard"("organizationId", "sourceSha256", "deletedAt");

CREATE TABLE "BusinessCardEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "detailJson" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessCardEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCardEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "BusinessCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessCardEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BusinessCardEvent_cardId_createdAt_idx" ON "BusinessCardEvent"("cardId", "createdAt");

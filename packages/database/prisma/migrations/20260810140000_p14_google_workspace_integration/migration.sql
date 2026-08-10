-- CreateTable
CREATE TABLE "GoogleWorkspaceConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "grantedScopesJson" TEXT NOT NULL DEFAULT '[]',
    "secretRef" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleWorkspaceConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleWorkspaceConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleOAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stateHash" TEXT NOT NULL,
    "pkceVerifierRef" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "redirectTarget" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleOAuthState_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleSyncOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT,
    "operationKind" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleSyncOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleSyncOperation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleSyncOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleSyncAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "responseClass" TEXT NOT NULL,
    "redactedError" TEXT,
    "retryAt" DATETIME,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleSyncAttempt_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "GoogleSyncOperation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleResourceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT,
    "operationId" TEXT,
    "entityType" TEXT NOT NULL,
    "internalEntityId" TEXT NOT NULL,
    "externalResourceId" TEXT NOT NULL,
    "resourceMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleResourceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleResourceLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleResourceLink_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "GoogleSyncOperation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleImportSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "operationId" TEXT,
    "sourceType" TEXT NOT NULL,
    "externalResourceId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "provenanceJson" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleImportSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleImportSnapshot_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleImportSnapshot_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "GoogleSyncOperation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoogleImportSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleWorkspaceConnection_organizationId_key" ON "GoogleWorkspaceConnection"("organizationId");
CREATE INDEX "GoogleWorkspaceConnection_organizationId_status_idx" ON "GoogleWorkspaceConnection"("organizationId", "status");
CREATE INDEX "GoogleWorkspaceConnection_createdById_idx" ON "GoogleWorkspaceConnection"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleOAuthState_stateHash_key" ON "GoogleOAuthState"("stateHash");
CREATE INDEX "GoogleOAuthState_organizationId_actorId_idx" ON "GoogleOAuthState"("organizationId", "actorId");
CREATE INDEX "GoogleOAuthState_expiresAt_idx" ON "GoogleOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "GoogleSyncOperation_organizationId_caseId_idx" ON "GoogleSyncOperation"("organizationId", "caseId");
CREATE INDEX "GoogleSyncOperation_operationKind_status_idx" ON "GoogleSyncOperation"("operationKind", "status");
CREATE INDEX "GoogleSyncOperation_actorId_idx" ON "GoogleSyncOperation"("actorId");
CREATE UNIQUE INDEX "GoogleSyncOperation_organizationId_operationKind_idempotencyKey_key" ON "GoogleSyncOperation"("organizationId", "operationKind", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GoogleSyncAttempt_operationId_idx" ON "GoogleSyncAttempt"("operationId");

-- CreateIndex
CREATE INDEX "GoogleResourceLink_organizationId_caseId_idx" ON "GoogleResourceLink"("organizationId", "caseId");
CREATE INDEX "GoogleResourceLink_entityType_internalEntityId_idx" ON "GoogleResourceLink"("entityType", "internalEntityId");
CREATE UNIQUE INDEX "GoogleResourceLink_organizationId_entityType_internalEntityId_externalResourceId_key" ON "GoogleResourceLink"("organizationId", "entityType", "internalEntityId", "externalResourceId");

-- CreateIndex
CREATE INDEX "GoogleImportSnapshot_organizationId_caseId_idx" ON "GoogleImportSnapshot"("organizationId", "caseId");
CREATE INDEX "GoogleImportSnapshot_externalResourceId_sha256_idx" ON "GoogleImportSnapshot"("externalResourceId", "sha256");
CREATE INDEX "GoogleImportSnapshot_createdById_idx" ON "GoogleImportSnapshot"("createdById");

-- -----------------------------------------------------------------------------
-- SQLite Immutability Triggers for Append-Only Google Tables
-- -----------------------------------------------------------------------------

CREATE TRIGGER "prevent_update_google_resource_link"
BEFORE UPDATE ON "GoogleResourceLink"
BEGIN
    SELECT RAISE(FAIL, 'GoogleResourceLink is immutable and cannot be updated.');
END;

CREATE TRIGGER "prevent_delete_google_resource_link"
BEFORE DELETE ON "GoogleResourceLink"
BEGIN
    SELECT RAISE(FAIL, 'GoogleResourceLink is immutable and cannot be deleted.');
END;

CREATE TRIGGER "prevent_update_google_import_snapshot"
BEFORE UPDATE ON "GoogleImportSnapshot"
BEGIN
    SELECT RAISE(FAIL, 'GoogleImportSnapshot is immutable and cannot be updated.');
END;

CREATE TRIGGER "prevent_delete_google_import_snapshot"
BEFORE DELETE ON "GoogleImportSnapshot"
BEGIN
    SELECT RAISE(FAIL, 'GoogleImportSnapshot is immutable and cannot be deleted.');
END;

CREATE TRIGGER "prevent_update_google_sync_attempt"
BEFORE UPDATE ON "GoogleSyncAttempt"
BEGIN
    SELECT RAISE(FAIL, 'GoogleSyncAttempt is immutable and cannot be updated.');
END;

CREATE TRIGGER "prevent_delete_google_sync_attempt"
BEFORE DELETE ON "GoogleSyncAttempt"
BEGIN
    SELECT RAISE(FAIL, 'GoogleSyncAttempt is immutable and cannot be deleted.');
END;

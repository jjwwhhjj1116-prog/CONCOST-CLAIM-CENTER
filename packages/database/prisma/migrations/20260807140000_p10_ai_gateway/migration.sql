-- CreateTable: AiProviderConfig
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "allowedModelsJson" TEXT NOT NULL DEFAULT '[]',
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "dailyBudgetMicros" INTEGER NOT NULL DEFAULT 100000000,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: AiCasePolicy
CREATE TABLE "AiCasePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "externalAiAllowed" BOOLEAN NOT NULL DEFAULT false,
    "maxTokensPerRequest" INTEGER NOT NULL DEFAULT 4096,
    "maxCostMicrosPerRequest" INTEGER NOT NULL DEFAULT 1000000,
    "allowedProviderIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiCasePolicy_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: AiUsageLedger
CREATE TABLE "AiUsageLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "requestId" TEXT,
    "transactionType" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsageLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiUsageLedger_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiUsageLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiUsageLedger_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiUsageLedger_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiGenerationRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: AiGenerationRequest
CREATE TABLE "AiGenerationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "promptSha256" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reservedCostMicros" INTEGER NOT NULL DEFAULT 0,
    "actualCostMicros" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "responseMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "redactedErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiGenerationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGenerationRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGenerationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGenerationRequest_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: AiGenerationAttempt
CREATE TABLE "AiGenerationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "redactedErrorMessage" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiGenerationAttempt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiGenerationRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indexes & Unique Constraints
CREATE INDEX "AiProviderConfig_organizationId_status_idx" ON "AiProviderConfig"("organizationId", "status");
CREATE UNIQUE INDEX "AiCasePolicy_caseId_key" ON "AiCasePolicy"("caseId");

CREATE INDEX "AiUsageLedger_organizationId_createdAt_idx" ON "AiUsageLedger"("organizationId", "createdAt");
CREATE INDEX "AiUsageLedger_caseId_idx" ON "AiUsageLedger"("caseId");
CREATE INDEX "AiUsageLedger_userId_idx" ON "AiUsageLedger"("userId");
CREATE INDEX "AiUsageLedger_requestId_idx" ON "AiUsageLedger"("requestId");

CREATE UNIQUE INDEX "AiGenerationRequest_organizationId_caseId_userId_idempotencyKey_key" ON "AiGenerationRequest"("organizationId", "caseId", "userId", "idempotencyKey");
CREATE INDEX "AiGenerationRequest_organizationId_status_idx" ON "AiGenerationRequest"("organizationId", "status");
CREATE INDEX "AiGenerationRequest_caseId_idx" ON "AiGenerationRequest"("caseId");
CREATE INDEX "AiGenerationRequest_userId_idx" ON "AiGenerationRequest"("userId");

CREATE INDEX "AiGenerationAttempt_requestId_attemptNumber_idx" ON "AiGenerationAttempt"("requestId", "attemptNumber");

-- Triggers for Guarding P10 Invariants

-- 1. Disallow raw API keys in secretRef
CREATE TRIGGER "P10_ai_provider_config_no_raw_secret_insert"
BEFORE INSERT ON "AiProviderConfig"
FOR EACH ROW
WHEN (NEW.secretRef LIKE 'sk-%' OR NEW.secretRef LIKE 'key-%' OR NEW.secretRef LIKE 'Bearer %' OR NEW.secretRef LIKE 'gsa_%')
BEGIN
    SELECT RAISE(FAIL, 'P10: Raw secret or API key string cannot be stored in secretRef');
END;

CREATE TRIGGER "P10_ai_provider_config_no_raw_secret_update"
BEFORE UPDATE ON "AiProviderConfig"
FOR EACH ROW
WHEN (NEW.secretRef LIKE 'sk-%' OR NEW.secretRef LIKE 'key-%' OR NEW.secretRef LIKE 'Bearer %' OR NEW.secretRef LIKE 'gsa_%')
BEGIN
    SELECT RAISE(FAIL, 'P10: Raw secret or API key string cannot be stored in secretRef');
END;

-- 2. Terminal State Guard for AiGenerationRequest
CREATE TRIGGER "P10_ai_generation_request_terminal_state_update"
BEFORE UPDATE ON "AiGenerationRequest"
FOR EACH ROW
WHEN (OLD.status IN ('COMPLETED', 'FAILED', 'CANCELED') AND NEW.status != OLD.status)
BEGIN
    SELECT RAISE(FAIL, 'P10: Terminal state generation requests cannot transition to another status');
END;

-- 3. Immutability for AiUsageLedger (Append-Only)
CREATE TRIGGER "P10_ai_usage_ledger_immutable_update"
BEFORE UPDATE ON "AiUsageLedger"
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P10: AiUsageLedger records are immutable and cannot be updated');
END;

CREATE TRIGGER "P10_ai_usage_ledger_immutable_delete"
BEFORE DELETE ON "AiUsageLedger"
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P10: AiUsageLedger records are immutable and cannot be deleted');
END;

-- 4. Immutability for AiGenerationAttempt (Append-Only)
CREATE TRIGGER "P10_ai_generation_attempt_immutable_update"
BEFORE UPDATE ON "AiGenerationAttempt"
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P10: AiGenerationAttempt records are immutable and cannot be updated');
END;

CREATE TRIGGER "P10_ai_generation_attempt_immutable_delete"
BEFORE DELETE ON "AiGenerationAttempt"
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P10: AiGenerationAttempt records are immutable and cannot be deleted');
END;

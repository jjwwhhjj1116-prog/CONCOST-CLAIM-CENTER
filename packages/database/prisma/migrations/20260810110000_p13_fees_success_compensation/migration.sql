-- CreateTable
CREATE TABLE "CaseFeeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "contractAmount" BIGINT NOT NULL DEFAULT 0,
    "hasSuccessFee" BOOLEAN NOT NULL DEFAULT true,
    "baseAmount" BIGINT NOT NULL DEFAULT 0,
    "feeRateBps" INTEGER NOT NULL DEFAULT 0,
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaseFeeConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeeConfig_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseFeeCalculation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "feeConfigId" TEXT NOT NULL,
    "calcType" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "contractAmount" BIGINT NOT NULL DEFAULT 0,
    "baseAmount" BIGINT NOT NULL DEFAULT 0,
    "feeRateBps" INTEGER NOT NULL DEFAULT 0,
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "calculatedFee" BIGINT NOT NULL DEFAULT 0,
    "taxAmount" BIGINT NOT NULL DEFAULT 0,
    "totalClaimFee" BIGINT NOT NULL DEFAULT 0,
    "formulaVersion" TEXT NOT NULL DEFAULT 'HALF_UP_BPS_V1',
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseFeeCalculation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeeCalculation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeeCalculation_feeConfigId_fkey" FOREIGN KEY ("feeConfigId") REFERENCES "CaseFeeConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeeCalculation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseFeePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "feeConfigId" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL DEFAULT 'PARTIAL',
    "amount" BIGINT NOT NULL DEFAULT 0,
    "paymentDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceStatus" TEXT NOT NULL DEFAULT 'NOT_ISSUED',
    "invoiceIssuedAt" DATETIME,
    "invoiceNumber" TEXT,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseFeePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeePayment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeePayment_feeConfigId_fkey" FOREIGN KEY ("feeConfigId") REFERENCES "CaseFeeConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeePayment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseFeeAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "unpaidBalance" BIGINT NOT NULL DEFAULT 0,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseFeeAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeeAudit_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseFeeAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseFeeConfig_caseId_key" ON "CaseFeeConfig"("caseId");
CREATE INDEX "CaseFeeConfig_organizationId_caseId_idx" ON "CaseFeeConfig"("organizationId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFeeCalculation_idempotencyKey_key" ON "CaseFeeCalculation"("idempotencyKey");
CREATE INDEX "CaseFeeCalculation_organizationId_caseId_idx" ON "CaseFeeCalculation"("organizationId", "caseId");
CREATE INDEX "CaseFeeCalculation_feeConfigId_idx" ON "CaseFeeCalculation"("feeConfigId");
CREATE INDEX "CaseFeeCalculation_actorId_idx" ON "CaseFeeCalculation"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFeePayment_idempotencyKey_key" ON "CaseFeePayment"("idempotencyKey");
CREATE INDEX "CaseFeePayment_organizationId_caseId_idx" ON "CaseFeePayment"("organizationId", "caseId");
CREATE INDEX "CaseFeePayment_feeConfigId_idx" ON "CaseFeePayment"("feeConfigId");
CREATE INDEX "CaseFeePayment_actorId_idx" ON "CaseFeePayment"("actorId");

-- CreateIndex
CREATE INDEX "CaseFeeAudit_organizationId_caseId_idx" ON "CaseFeeAudit"("organizationId", "caseId");
CREATE INDEX "CaseFeeAudit_actorId_idx" ON "CaseFeeAudit"("actorId");

-- SQLite Immutability Triggers (Append-Only Enforcement)
CREATE TRIGGER "trg_block_update_CaseFeeCalculation"
BEFORE UPDATE ON "CaseFeeCalculation"
BEGIN
    SELECT RAISE(ABORT, 'CaseFeeCalculation is append-only and cannot be updated');
END;

CREATE TRIGGER "trg_block_delete_CaseFeeCalculation"
BEFORE DELETE ON "CaseFeeCalculation"
BEGIN
    SELECT RAISE(ABORT, 'CaseFeeCalculation is append-only and cannot be deleted');
END;

CREATE TRIGGER "trg_block_update_CaseFeePayment"
BEFORE UPDATE ON "CaseFeePayment"
BEGIN
    SELECT RAISE(ABORT, 'CaseFeePayment is append-only and cannot be updated');
END;

CREATE TRIGGER "trg_block_delete_CaseFeePayment"
BEFORE DELETE ON "CaseFeePayment"
BEGIN
    SELECT RAISE(ABORT, 'CaseFeePayment is append-only and cannot be deleted');
END;

CREATE TRIGGER "trg_block_update_CaseFeeAudit"
BEFORE UPDATE ON "CaseFeeAudit"
BEGIN
    SELECT RAISE(ABORT, 'CaseFeeAudit is append-only and cannot be updated');
END;

CREATE TRIGGER "trg_block_delete_CaseFeeAudit"
BEFORE DELETE ON "CaseFeeAudit"
BEGIN
    SELECT RAISE(ABORT, 'CaseFeeAudit is append-only and cannot be deleted');
END;

-- P05 extends the P04 CaseItem in place. Do not rebuild/drop it: existing
-- assignments, reports, report sections and audit references must survive.
ALTER TABLE "CaseItem" ADD COLUMN "caseNumber" TEXT;
ALTER TABLE "CaseItem" ADD COLUMN "description" TEXT;
ALTER TABLE "CaseItem" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'INQUIRY';
ALTER TABLE "CaseItem" ADD COLUMN "assignedUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "CaseItem" SET "caseNumber" = "id" WHERE "caseNumber" IS NULL;

CREATE UNIQUE INDEX "CaseItem_caseNumber_key" ON "CaseItem"("caseNumber");
CREATE INDEX "CaseItem_caseNumber_idx" ON "CaseItem"("caseNumber");
CREATE INDEX "CaseItem_status_idx" ON "CaseItem"("status");

CREATE TABLE "CaseCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "major" TEXT NOT NULL,
    "middle" TEXT NOT NULL,
    "minor" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaseCategory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CaseCategory_caseId_key" ON "CaseCategory"("caseId");
CREATE INDEX "CaseCategory_major_middle_minor_idx" ON "CaseCategory"("major", "middle", "minor");

CREATE TABLE "Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contact" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Party_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('COURT', 'CLIENT', 'INTERNAL')),
    "date" DATETIME NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "fromStatus" TEXT CHECK ("fromStatus" IS NULL OR "fromStatus" IN ('INQUIRY','PROPOSAL','ESTIMATE','CONTRACT','MATERIAL_RECEIVED','ANALYSIS','REPORT_DRAFTING','SUBMITTED','LITIGATION','JUDGEMENT','SUCCESS_FEE','CLOSED')),
    "toStatus" TEXT NOT NULL CHECK ("toStatus" IN ('INQUIRY','PROPOSAL','ESTIMATE','CONTRACT','MATERIAL_RECEIVED','ANALYSIS','REPORT_DRAFTING','SUBMITTED','LITIGATION','JUDGEMENT','SUCCESS_FEE','CLOSED')),
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Party_caseId_idx" ON "Party"("caseId");
CREATE INDEX "Party_name_idx" ON "Party"("name");
CREATE INDEX "Schedule_caseId_idx" ON "Schedule"("caseId");
CREATE INDEX "Schedule_date_idx" ON "Schedule"("date");
CREATE INDEX "Schedule_type_idx" ON "Schedule"("type");
CREATE INDEX "StatusHistory_caseId_createdAt_idx" ON "StatusHistory"("caseId", "createdAt");

-- SQLite cannot add table CHECK constraints in-place. Equivalent triggers keep
-- the six claim types, twelve product states, non-empty case number and same-org
-- assignment invariant at the database boundary.
CREATE TRIGGER "CaseItem_p05_validate_insert"
BEFORE INSERT ON "CaseItem"
WHEN NEW."claimType" NOT IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')
  OR NEW."status" NOT IN ('INQUIRY','PROPOSAL','ESTIMATE','CONTRACT','MATERIAL_RECEIVED','ANALYSIS','REPORT_DRAFTING','SUBMITTED','LITIGATION','JUDGEMENT','SUCCESS_FEE','CLOSED')
  OR NEW."caseNumber" IS NULL OR trim(NEW."caseNumber") = ''
  OR (NEW."assignedUserId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id" = NEW."assignedUserId" AND "organizationId" = NEW."organizationId"
  ))
BEGIN
  SELECT RAISE(ABORT, 'CaseItem P05 constraint violation');
END;

CREATE TRIGGER "CaseItem_p05_validate_update"
BEFORE UPDATE OF "organizationId", "claimType", "status", "caseNumber", "assignedUserId" ON "CaseItem"
WHEN NEW."claimType" NOT IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')
  OR NEW."status" NOT IN ('INQUIRY','PROPOSAL','ESTIMATE','CONTRACT','MATERIAL_RECEIVED','ANALYSIS','REPORT_DRAFTING','SUBMITTED','LITIGATION','JUDGEMENT','SUCCESS_FEE','CLOSED')
  OR NEW."caseNumber" IS NULL OR trim(NEW."caseNumber") = ''
  OR (NEW."assignedUserId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id" = NEW."assignedUserId" AND "organizationId" = NEW."organizationId"
  ))
BEGIN
  SELECT RAISE(ABORT, 'CaseItem P05 constraint violation');
END;

CREATE TRIGGER "CaseAssignment_same_org_insert"
BEFORE INSERT ON "CaseAssignment"
WHEN NOT EXISTS (
  SELECT 1 FROM "CaseItem" c JOIN "User" u ON u."id" = NEW."userId"
  WHERE c."id" = NEW."caseId" AND c."organizationId" = u."organizationId"
)
BEGIN
  SELECT RAISE(ABORT, 'CaseAssignment cross-organization assignment forbidden');
END;

CREATE TRIGGER "CaseAssignment_same_org_update"
BEFORE UPDATE ON "CaseAssignment"
WHEN NOT EXISTS (
  SELECT 1 FROM "CaseItem" c JOIN "User" u ON u."id" = NEW."userId"
  WHERE c."id" = NEW."caseId" AND c."organizationId" = u."organizationId"
)
BEGIN
  SELECT RAISE(ABORT, 'CaseAssignment cross-organization assignment forbidden');
END;

CREATE TRIGGER "StatusHistory_prevent_update"
BEFORE UPDATE ON "StatusHistory"
BEGIN
  SELECT RAISE(ABORT, 'StatusHistory is append-only: UPDATE forbidden');
END;

CREATE TRIGGER "StatusHistory_prevent_delete"
BEFORE DELETE ON "StatusHistory"
BEGIN
  SELECT RAISE(ABORT, 'StatusHistory is append-only: DELETE forbidden');
END;

-- Create Table Party
CREATE TABLE "Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contact" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Party_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create Table Schedule
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
    CONSTRAINT "Schedule_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create Table StatusHistory
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Redefine CaseItem to add new columns and constraints
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "claimType" TEXT NOT NULL CHECK ("claimType" IN ('TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06')),
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "assignedUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaseItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseItem_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_CaseItem" ("id", "organizationId", "caseNumber", "title", "description", "claimType", "status", "assignedUserId", "version", "deletedAt", "createdAt", "updatedAt")
SELECT "id", "organizationId", "id" AS "caseNumber", "title", NULL AS "description", "claimType", 'REGISTERED' AS "status", NULL AS "assignedUserId", "version", "deletedAt", "createdAt", "updatedAt" FROM "CaseItem";

DROP TABLE "CaseItem";
ALTER TABLE "new_CaseItem" RENAME TO "CaseItem";

CREATE UNIQUE INDEX "CaseItem_caseNumber_key" ON "CaseItem"("caseNumber");
CREATE INDEX "CaseItem_organizationId_deletedAt_idx" ON "CaseItem"("organizationId", "deletedAt");
CREATE INDEX "CaseItem_caseNumber_idx" ON "CaseItem"("caseNumber");
CREATE INDEX "CaseItem_status_idx" ON "CaseItem"("status");

PRAGMA foreign_keys=ON;

-- Create Indexes for new tables
CREATE INDEX "Party_caseId_idx" ON "Party"("caseId");
CREATE INDEX "Party_name_idx" ON "Party"("name");

CREATE INDEX "Schedule_caseId_idx" ON "Schedule"("caseId");
CREATE INDEX "Schedule_date_idx" ON "Schedule"("date");
CREATE INDEX "Schedule_type_idx" ON "Schedule"("type");

CREATE INDEX "StatusHistory_caseId_createdAt_idx" ON "StatusHistory"("caseId", "createdAt");

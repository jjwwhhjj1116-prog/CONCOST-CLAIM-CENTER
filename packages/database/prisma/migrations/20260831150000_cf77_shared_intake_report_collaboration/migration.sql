-- Additive SQLite parity for CF77. No existing case, report, section, or file
-- row is changed or removed.

CREATE TABLE "ReportSectionAssignment" (
  "sectionId" TEXT NOT NULL PRIMARY KEY,
  "assigneeId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReportSectionAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportSectionAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportSectionAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ReportSectionAssignment_assigneeId_status_updatedAt_idx"
  ON "ReportSectionAssignment"("assigneeId", "status", "updatedAt");

CREATE TABLE "CaseScheduleVisibility" (
  "caseId" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reasonCode" TEXT,
  "reasonText" TEXT,
  "driveVerified" BOOLEAN NOT NULL DEFAULT false,
  "manifestSha256" TEXT,
  "verificationJson" TEXT NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CaseScheduleVisibility_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseScheduleVisibility_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CaseScheduleVisibility_organizationId_visibility_updatedAt_idx"
  ON "CaseScheduleVisibility"("organizationId", "visibility", "updatedAt");

CREATE TABLE "CaseScheduleVisibilityEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fromVisibility" TEXT NOT NULL,
  "toVisibility" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reasonText" TEXT NOT NULL,
  "driveVerified" BOOLEAN NOT NULL,
  "manifestSha256" TEXT,
  "verificationJson" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseScheduleVisibilityEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseScheduleVisibilityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CaseScheduleVisibilityEvent_caseId_createdAt_idx"
  ON "CaseScheduleVisibilityEvent"("caseId", "createdAt");

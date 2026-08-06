-- Create Table Document
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT NOT NULL CHECK ("source" IN ('RECEIVED', 'AUTHORED', 'SUBMITTED')),
    "currentVersionId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create Table DocumentVersion
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create Table Meeting
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingDate" DATETIME NOT NULL,
    "location" TEXT,
    "attendees" TEXT,
    "rawText" TEXT,
    "summary" TEXT,
    "decisions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'FINAL')),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Meeting_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create Table MeetingActionItem
CREATE TABLE "MeetingActionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT,
    "scheduleId" TEXT,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Create Indexes for Document & DocumentVersion
CREATE INDEX "Document_caseId_deletedAt_idx" ON "Document"("caseId", "deletedAt");
CREATE INDEX "Document_source_idx" ON "Document"("source");

CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");
CREATE INDEX "DocumentVersion_storageKey_idx" ON "DocumentVersion"("storageKey");

-- Create Indexes for Meeting & MeetingActionItem
CREATE INDEX "Meeting_caseId_idx" ON "Meeting"("caseId");
CREATE INDEX "Meeting_meetingDate_idx" ON "Meeting"("meetingDate");
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");
CREATE INDEX "MeetingActionItem_assigneeId_idx" ON "MeetingActionItem"("assigneeId");
CREATE INDEX "MeetingActionItem_scheduleId_idx" ON "MeetingActionItem"("scheduleId");

-- DB Triggers for Finalized Meeting Immutability
CREATE TRIGGER "P06_prevent_final_meeting_update"
BEFORE UPDATE ON "Meeting"
FOR EACH ROW
WHEN OLD."status" = 'FINAL'
BEGIN
    SELECT RAISE(ABORT, 'Finalized meeting cannot be updated');
END;

CREATE TRIGGER "P06_prevent_final_meeting_delete"
BEFORE DELETE ON "Meeting"
FOR EACH ROW
WHEN OLD."status" = 'FINAL'
BEGIN
    SELECT RAISE(ABORT, 'Finalized meeting cannot be deleted');
END;

-- P06 lossless additive migration: materials, document versions and meetings.
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "reportSectionId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT NOT NULL CHECK ("source" IN ('RECEIVED', 'AUTHORED', 'SUBMITTED')),
    "currentVersionId" TEXT,
    "finalVersionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_reportSectionId_fkey" FOREIGN KEY ("reportSectionId") REFERENCES "ReportSection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "originalName" TEXT NOT NULL CHECK ("originalName" NOT LIKE '%/%' AND "originalName" NOT LIKE '%\%' AND "originalName" NOT LIKE '%..%'),
    "displayName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL CHECK ("storageKey" NOT LIKE '%/%' AND "storageKey" NOT LIKE '%\%' AND "storageKey" NOT LIKE '%..%'),
    "fileSize" INTEGER NOT NULL CHECK ("fileSize" > 0 AND "fileSize" <= 10485760),
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL CHECK (length("sha256") = 64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingDate" DATETIME NOT NULL,
    "location" TEXT,
    "attendees" TEXT,
    "rawText" TEXT,
    "rawTextSha256" TEXT CHECK ("rawTextSha256" IS NULL OR (length("rawTextSha256") = 64 AND "rawTextSha256" NOT GLOB '*[^0-9a-f]*')),
    "summary" TEXT,
    "decisions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'FINAL')),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Meeting_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Document_caseId_deletedAt_idx" ON "Document"("caseId", "deletedAt");
CREATE INDEX "Document_scheduleId_idx" ON "Document"("scheduleId");
CREATE INDEX "Document_reportSectionId_idx" ON "Document"("reportSectionId");
CREATE INDEX "Document_source_idx" ON "Document"("source");
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");
CREATE UNIQUE INDEX "DocumentVersion_one_final_per_document" ON "DocumentVersion"("documentId") WHERE "isFinal" = 1;
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");
CREATE INDEX "Meeting_caseId_idx" ON "Meeting"("caseId");
CREATE INDEX "Meeting_meetingDate_idx" ON "Meeting"("meetingDate");
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");
CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");
CREATE INDEX "MeetingActionItem_assigneeId_idx" ON "MeetingActionItem"("assigneeId");
CREATE INDEX "MeetingActionItem_scheduleId_idx" ON "MeetingActionItem"("scheduleId");

-- A document may only link to a schedule/report section from its own case.
CREATE TRIGGER "P06_document_links_insert" BEFORE INSERT ON "Document" FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."scheduleId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Schedule" s WHERE s."id" = NEW."scheduleId" AND s."caseId" = NEW."caseId"
  ) THEN RAISE(ABORT, 'Document schedule must belong to the same case') END;
  SELECT CASE WHEN NEW."reportSectionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ReportSection" rs JOIN "Report" r ON r."id" = rs."reportId"
    WHERE rs."id" = NEW."reportSectionId" AND r."caseId" = NEW."caseId"
  ) THEN RAISE(ABORT, 'Document report section must belong to the same case') END;
END;
CREATE TRIGGER "P06_document_links_update" BEFORE UPDATE OF "caseId", "scheduleId", "reportSectionId" ON "Document" FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."scheduleId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Schedule" s WHERE s."id" = NEW."scheduleId" AND s."caseId" = NEW."caseId"
  ) THEN RAISE(ABORT, 'Document schedule must belong to the same case') END;
  SELECT CASE WHEN NEW."reportSectionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ReportSection" rs JOIN "Report" r ON r."id" = rs."reportId"
    WHERE rs."id" = NEW."reportSectionId" AND r."caseId" = NEW."caseId"
  ) THEN RAISE(ABORT, 'Document report section must belong to the same case') END;
END;

-- Current/final pointers must reference a version of the same document.
CREATE TRIGGER "P06_document_version_pointers" BEFORE UPDATE OF "currentVersionId", "finalVersionId" ON "Document" FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."currentVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DocumentVersion" v WHERE v."id" = NEW."currentVersionId" AND v."documentId" = NEW."id"
  ) THEN RAISE(ABORT, 'Current version must belong to the document') END;
  SELECT CASE WHEN NEW."finalVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DocumentVersion" v WHERE v."id" = NEW."finalVersionId" AND v."documentId" = NEW."id" AND v."isFinal" = 1
  ) THEN RAISE(ABORT, 'Final version must belong to the document and be final') END;
END;
CREATE TRIGGER "P06_document_version_delete_guard" BEFORE DELETE ON "DocumentVersion" FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM "Document" d WHERE d."currentVersionId" = OLD."id" OR d."finalVersionId" = OLD."id"
) BEGIN SELECT RAISE(ABORT, 'Referenced document version cannot be deleted'); END;
CREATE TRIGGER "P06_final_version_content_immutable" BEFORE UPDATE ON "DocumentVersion" FOR EACH ROW
WHEN OLD."isFinal" = 1 AND (
  NEW."documentId" IS NOT OLD."documentId" OR NEW."versionNumber" IS NOT OLD."versionNumber" OR
  NEW."originalName" IS NOT OLD."originalName" OR NEW."displayName" IS NOT OLD."displayName" OR
  NEW."storageKey" IS NOT OLD."storageKey" OR NEW."fileSize" IS NOT OLD."fileSize" OR
  NEW."mimeType" IS NOT OLD."mimeType" OR NEW."sha256" IS NOT OLD."sha256" OR NEW."uploadedById" IS NOT OLD."uploadedById"
) BEGIN SELECT RAISE(ABORT, 'Final document version content is immutable'); END;

-- Original transcript is write-once; a finalized meeting and its action items are immutable.
CREATE TRIGGER "P06_meeting_raw_text_immutable" BEFORE UPDATE OF "rawText", "rawTextSha256" ON "Meeting" FOR EACH ROW
WHEN OLD."rawText" IS NOT NULL AND (NEW."rawText" IS NOT OLD."rawText" OR NEW."rawTextSha256" IS NOT OLD."rawTextSha256")
BEGIN SELECT RAISE(ABORT, 'Meeting original transcript is immutable'); END;
CREATE TRIGGER "P06_prevent_final_meeting_update" BEFORE UPDATE ON "Meeting" FOR EACH ROW
WHEN OLD."status" = 'FINAL' BEGIN SELECT RAISE(ABORT, 'Finalized meeting cannot be updated'); END;
CREATE TRIGGER "P06_prevent_final_meeting_delete" BEFORE DELETE ON "Meeting" FOR EACH ROW
WHEN OLD."status" = 'FINAL' BEGIN SELECT RAISE(ABORT, 'Finalized meeting cannot be deleted'); END;

CREATE TRIGGER "P06_action_item_insert_guard" BEFORE INSERT ON "MeetingActionItem" FOR EACH ROW BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM "Meeting" m WHERE m."id" = NEW."meetingId" AND m."status" = 'FINAL')
    THEN RAISE(ABORT, 'Finalized meeting action items are immutable') END;
  SELECT CASE WHEN NEW."assigneeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" u JOIN "Meeting" m ON m."id" = NEW."meetingId" JOIN "CaseItem" c ON c."id" = m."caseId"
    WHERE u."id" = NEW."assigneeId" AND u."organizationId" = c."organizationId"
  ) THEN RAISE(ABORT, 'Action item assignee must belong to the meeting organization') END;
  SELECT CASE WHEN NEW."scheduleId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Schedule" s JOIN "Meeting" m ON m."id" = NEW."meetingId"
    WHERE s."id" = NEW."scheduleId" AND s."caseId" = m."caseId"
  ) THEN RAISE(ABORT, 'Action item schedule must belong to the meeting case') END;
END;
CREATE TRIGGER "P06_action_item_update_guard" BEFORE UPDATE ON "MeetingActionItem" FOR EACH ROW BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM "Meeting" m WHERE m."id" = OLD."meetingId" AND m."status" = 'FINAL')
    THEN RAISE(ABORT, 'Finalized meeting action items are immutable') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM "Meeting" m WHERE m."id" = NEW."meetingId" AND m."status" = 'FINAL')
    THEN RAISE(ABORT, 'Finalized meeting action items are immutable') END;
  SELECT CASE WHEN NEW."assigneeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" u JOIN "Meeting" m ON m."id" = NEW."meetingId" JOIN "CaseItem" c ON c."id" = m."caseId"
    WHERE u."id" = NEW."assigneeId" AND u."organizationId" = c."organizationId"
  ) THEN RAISE(ABORT, 'Action item assignee must belong to the meeting organization') END;
  SELECT CASE WHEN NEW."scheduleId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Schedule" s JOIN "Meeting" m ON m."id" = NEW."meetingId"
    WHERE s."id" = NEW."scheduleId" AND s."caseId" = m."caseId"
  ) THEN RAISE(ABORT, 'Action item schedule must belong to the meeting case') END;
END;
CREATE TRIGGER "P06_action_item_delete_guard" BEFORE DELETE ON "MeetingActionItem" FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM "Meeting" m WHERE m."id" = OLD."meetingId" AND m."status" = 'FINAL')
BEGIN SELECT RAISE(ABORT, 'Finalized meeting action items are immutable'); END;

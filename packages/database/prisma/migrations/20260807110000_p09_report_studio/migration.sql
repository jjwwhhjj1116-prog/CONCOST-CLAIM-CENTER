-- CreateTable
CREATE TABLE "ReportSectionRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "structuredDataJson" TEXT NOT NULL DEFAULT '{}',
    "validationStatus" TEXT NOT NULL DEFAULT 'VALID',
    "validationErrorsJson" TEXT NOT NULL DEFAULT '[]',
    "inputSha256" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSectionRevision_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportEvidenceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDocumentVersionId" TEXT,
    "sourceMeetingId" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "quoteText" TEXT,
    "anchorPosition" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportEvidenceLink_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportEvidenceLink_sourceDocumentVersionId_fkey" FOREIGN KEY ("sourceDocumentVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReportEvidenceLink_sourceMeetingId_fkey" FOREIGN KEY ("sourceMeetingId") REFERENCES "Meeting" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportSectionComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "revisionId" TEXT,
    "authorId" TEXT NOT NULL,
    "commentType" TEXT NOT NULL DEFAULT 'COMMENT',
    "content" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSectionComment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionComment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionComment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportSectionApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "approvedRevisionId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSectionApproval_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionApproval_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportMergeSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "mergedBodyText" TEXT NOT NULL,
    "sectionsSnapshotJson" TEXT NOT NULL,
    "evidenceSnapshotJson" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportMergeSnapshot_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportMergeSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSectionRevision_sectionId_revisionNumber_key" ON "ReportSectionRevision"("sectionId", "revisionNumber");
CREATE INDEX "ReportSectionRevision_sectionId_idx" ON "ReportSectionRevision"("sectionId");
CREATE INDEX "ReportSectionRevision_authorId_idx" ON "ReportSectionRevision"("authorId");

-- CreateIndex
CREATE INDEX "ReportEvidenceLink_revisionId_idx" ON "ReportEvidenceLink"("revisionId");
CREATE INDEX "ReportEvidenceLink_sourceDocumentVersionId_idx" ON "ReportEvidenceLink"("sourceDocumentVersionId");
CREATE INDEX "ReportEvidenceLink_sourceMeetingId_idx" ON "ReportEvidenceLink"("sourceMeetingId");

-- CreateIndex
CREATE INDEX "ReportSectionComment_sectionId_idx" ON "ReportSectionComment"("sectionId");
CREATE INDEX "ReportSectionComment_revisionId_idx" ON "ReportSectionComment"("revisionId");
CREATE INDEX "ReportSectionComment_authorId_idx" ON "ReportSectionComment"("authorId");

-- CreateIndex
CREATE INDEX "ReportSectionApproval_sectionId_idx" ON "ReportSectionApproval"("sectionId");
CREATE INDEX "ReportSectionApproval_approvedRevisionId_idx" ON "ReportSectionApproval"("approvedRevisionId");
CREATE INDEX "ReportSectionApproval_approverId_idx" ON "ReportSectionApproval"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportMergeSnapshot_reportId_snapshotVersion_key" ON "ReportMergeSnapshot"("reportId", "snapshotVersion");
CREATE INDEX "ReportMergeSnapshot_reportId_idx" ON "ReportMergeSnapshot"("reportId");
CREATE INDEX "ReportMergeSnapshot_createdById_idx" ON "ReportMergeSnapshot"("createdById");

-- DB Trigger: Prevent Self-Approval on ReportSection
CREATE TRIGGER P09_report_section_approval_no_self_approval
BEFORE INSERT ON ReportSectionApproval
FOR EACH ROW
BEGIN
    SELECT CASE
        WHEN (SELECT authorId FROM ReportSectionRevision WHERE id = NEW.approvedRevisionId) = NEW.approverId
        THEN RAISE(FAIL, 'P09: Self-approval is strictly forbidden')
    END;
END;

-- DB Trigger: Immutable APPROVED ReportSectionRevision
CREATE TRIGGER P09_report_section_approved_immutable_update
BEFORE UPDATE ON ReportSectionRevision
FOR EACH ROW
WHEN (SELECT status FROM ReportSection WHERE id = OLD.sectionId) = 'APPROVED'
BEGIN
    SELECT RAISE(FAIL, 'P09: APPROVED section revisions are DB-immutable');
END;

-- DB Trigger: Immutable ReportMergeSnapshot
CREATE TRIGGER P09_report_merge_snapshot_immutable_update
BEFORE UPDATE ON ReportMergeSnapshot
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P09: ReportMergeSnapshot rows are DB-immutable');
END;

CREATE TRIGGER P09_report_merge_snapshot_immutable_delete
BEFORE DELETE ON ReportMergeSnapshot
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P09: ReportMergeSnapshot rows are DB-immutable');
END;

-- P09 is additive: an immutable revision/event layer is added above the P08 report snapshot.
CREATE TABLE "ReportSectionRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL CHECK ("revisionNumber" > 0),
    "title" TEXT NOT NULL CHECK (length(trim("title")) BETWEEN 1 AND 300),
    "content" TEXT NOT NULL CHECK (length("content") BETWEEN 1 AND 100000),
    "structuredDataJson" TEXT NOT NULL DEFAULT '{}',
    "validationStatus" TEXT NOT NULL DEFAULT 'VALID' CHECK ("validationStatus" IN ('VALID', 'WARNING', 'INVALID')),
    "validationErrorsJson" TEXT NOT NULL DEFAULT '[]',
    "inputSha256" TEXT NOT NULL CHECK (length("inputSha256") = 64 AND lower("inputSha256") NOT GLOB '*[^0-9a-f]*'),
    "sha256" TEXT NOT NULL CHECK (length("sha256") = 64 AND lower("sha256") NOT GLOB '*[^0-9a-f]*'),
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSectionRevision_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ReportEvidenceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('DOCUMENT', 'MEETING')),
    "sourceId" TEXT NOT NULL,
    "sourceDocumentVersionId" TEXT,
    "sourceMeetingId" TEXT,
    "sourceSha256" TEXT NOT NULL CHECK (length("sourceSha256") = 64 AND lower("sourceSha256") NOT GLOB '*[^0-9a-f]*'),
    "sourceVersion" INTEGER NOT NULL CHECK ("sourceVersion" > 0),
    "targetParagraphIndex" INTEGER NOT NULL CHECK ("targetParagraphIndex" >= 0),
    "quoteText" TEXT CHECK ("quoteText" IS NULL OR length("quoteText") <= 4000),
    "anchorPosition" TEXT CHECK ("anchorPosition" IS NULL OR length("anchorPosition") <= 500),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("sourceType" = 'DOCUMENT' AND "sourceDocumentVersionId" IS NOT NULL AND "sourceMeetingId" IS NULL)
        OR ("sourceType" = 'MEETING' AND "sourceMeetingId" IS NOT NULL AND "sourceDocumentVersionId" IS NULL)),
    CONSTRAINT "ReportEvidenceLink_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportEvidenceLink_sourceDocumentVersionId_fkey" FOREIGN KEY ("sourceDocumentVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportEvidenceLink_sourceMeetingId_fkey" FOREIGN KEY ("sourceMeetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ReportSectionComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "revisionId" TEXT,
    "authorId" TEXT NOT NULL,
    "commentType" TEXT NOT NULL DEFAULT 'COMMENT' CHECK ("commentType" IN ('COMMENT', 'REVISION_REQUEST')),
    "content" TEXT NOT NULL CHECK (length(trim("content")) BETWEEN 1 AND 4000),
    "isResolved" BOOLEAN NOT NULL DEFAULT false CHECK ("isResolved" IN (0, 1)),
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("isResolved" = 0 AND "resolvedById" IS NULL AND "resolvedAt" IS NULL)
        OR ("isResolved" = 1 AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL)),
    CONSTRAINT "ReportSectionComment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionComment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionComment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ReportSectionApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "approvedRevisionId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "eventNumber" INTEGER NOT NULL CHECK ("eventNumber" > 0),
    "status" TEXT NOT NULL DEFAULT 'APPROVED' CHECK ("status" IN ('APPROVED', 'UNLOCKED')),
    "comment" TEXT CHECK ("comment" IS NULL OR length("comment") <= 4000),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSectionApproval_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionApproval_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportSectionApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ReportMergeSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL CHECK ("snapshotVersion" > 0),
    "mergedBodyText" TEXT NOT NULL,
    "sectionsSnapshotJson" TEXT NOT NULL,
    "evidenceSnapshotJson" TEXT NOT NULL,
    "snapshotSha256" TEXT NOT NULL CHECK (length("snapshotSha256") = 64 AND lower("snapshotSha256") NOT GLOB '*[^0-9a-f]*'),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportMergeSnapshot_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportMergeSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReportSectionRevision_sectionId_revisionNumber_key" ON "ReportSectionRevision"("sectionId", "revisionNumber");
CREATE INDEX "ReportSectionRevision_sectionId_idx" ON "ReportSectionRevision"("sectionId");
CREATE INDEX "ReportSectionRevision_authorId_idx" ON "ReportSectionRevision"("authorId");
CREATE UNIQUE INDEX "ReportEvidenceLink_revisionId_sourceType_sourceId_targetParagraphIndex_key"
  ON "ReportEvidenceLink"("revisionId", "sourceType", "sourceId", "targetParagraphIndex");
CREATE INDEX "ReportEvidenceLink_revisionId_idx" ON "ReportEvidenceLink"("revisionId");
CREATE INDEX "ReportEvidenceLink_sourceDocumentVersionId_idx" ON "ReportEvidenceLink"("sourceDocumentVersionId");
CREATE INDEX "ReportEvidenceLink_sourceMeetingId_idx" ON "ReportEvidenceLink"("sourceMeetingId");
CREATE INDEX "ReportSectionComment_sectionId_idx" ON "ReportSectionComment"("sectionId");
CREATE INDEX "ReportSectionComment_revisionId_idx" ON "ReportSectionComment"("revisionId");
CREATE INDEX "ReportSectionComment_authorId_idx" ON "ReportSectionComment"("authorId");
CREATE UNIQUE INDEX "ReportSectionApproval_sectionId_eventNumber_key" ON "ReportSectionApproval"("sectionId", "eventNumber");
CREATE INDEX "ReportSectionApproval_sectionId_idx" ON "ReportSectionApproval"("sectionId");
CREATE INDEX "ReportSectionApproval_approvedRevisionId_idx" ON "ReportSectionApproval"("approvedRevisionId");
CREATE INDEX "ReportSectionApproval_approverId_idx" ON "ReportSectionApproval"("approverId");
CREATE UNIQUE INDEX "ReportMergeSnapshot_reportId_snapshotVersion_key" ON "ReportMergeSnapshot"("reportId", "snapshotVersion");
CREATE INDEX "ReportMergeSnapshot_reportId_idx" ON "ReportMergeSnapshot"("reportId");
CREATE INDEX "ReportMergeSnapshot_createdById_idx" ON "ReportMergeSnapshot"("createdById");

CREATE TRIGGER "P09_revision_insert_guard"
BEFORE INSERT ON "ReportSectionRevision"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ReportSection" s JOIN "Report" r ON r."id" = s."reportId"
    JOIN "CaseItem" c ON c."id" = r."caseId"
    JOIN "User" u ON u."id" = NEW."authorId"
    WHERE s."id" = NEW."sectionId" AND r."reportInstanceId" IS NOT NULL
      AND r."deletedAt" IS NULL AND s."deletedAt" IS NULL AND c."deletedAt" IS NULL
      AND c."organizationId" = u."organizationId"
      AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'pm', 'staff'))
      AND (EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" = 'admin')
        OR EXISTS (SELECT 1 FROM "CaseAssignment" ca WHERE ca."caseId" = c."id" AND ca."userId" = u."id"))
  ) THEN RAISE(ABORT, 'P09_REVISION_SCOPE_INVALID') END;
  SELECT CASE WHEN NEW."revisionNumber" <> COALESCE((SELECT MAX("revisionNumber") + 1 FROM "ReportSectionRevision" WHERE "sectionId" = NEW."sectionId"), 1)
    THEN RAISE(ABORT, 'P09_REVISION_NUMBER_NOT_MONOTONIC') END;
END;
CREATE TRIGGER "P09_revision_immutable_update" BEFORE UPDATE ON "ReportSectionRevision"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_REVISION_IMMUTABLE'); END;
CREATE TRIGGER "P09_revision_immutable_delete" BEFORE DELETE ON "ReportSectionRevision"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_REVISION_IMMUTABLE'); END;

CREATE TRIGGER "P09_evidence_insert_guard"
BEFORE INSERT ON "ReportEvidenceLink"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."sourceType" = 'DOCUMENT' AND NOT EXISTS (
    SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d."id" = dv."documentId"
    JOIN "ReportSectionRevision" rv ON rv."id" = NEW."revisionId"
    JOIN "ReportSection" s ON s."id" = rv."sectionId" JOIN "Report" r ON r."id" = s."reportId"
    WHERE dv."id" = NEW."sourceDocumentVersionId" AND NEW."sourceId" = dv."id"
      AND NEW."sourceSha256" = dv."sha256" AND NEW."sourceVersion" = dv."versionNumber"
      AND d."caseId" = r."caseId" AND d."deletedAt" IS NULL
  ) THEN RAISE(ABORT, 'P09_DOCUMENT_EVIDENCE_PROVENANCE_INVALID') END;
  SELECT CASE WHEN NEW."sourceType" = 'MEETING' AND NOT EXISTS (
    SELECT 1 FROM "Meeting" m JOIN "ReportSectionRevision" rv ON rv."id" = NEW."revisionId"
    JOIN "ReportSection" s ON s."id" = rv."sectionId" JOIN "Report" r ON r."id" = s."reportId"
    WHERE m."id" = NEW."sourceMeetingId" AND NEW."sourceId" = m."id"
      AND m."caseId" = r."caseId" AND m."status" = 'FINAL' AND m."rawTextSha256" IS NOT NULL
      AND NEW."sourceSha256" = m."rawTextSha256" AND NEW."sourceVersion" = m."version"
  ) THEN RAISE(ABORT, 'P09_MEETING_EVIDENCE_PROVENANCE_INVALID') END;
END;
CREATE TRIGGER "P09_evidence_immutable_update" BEFORE UPDATE ON "ReportEvidenceLink"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER "P09_evidence_immutable_delete" BEFORE DELETE ON "ReportEvidenceLink"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER "P09_comment_insert_guard"
BEFORE INSERT ON "ReportSectionComment"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ReportSection" s JOIN "Report" r ON r."id" = s."reportId"
    JOIN "CaseItem" c ON c."id" = r."caseId" JOIN "User" u ON u."id" = NEW."authorId"
    WHERE s."id" = NEW."sectionId" AND r."reportInstanceId" IS NOT NULL
      AND c."organizationId" = u."organizationId"
      AND (EXISTS (SELECT 1 FROM "CaseAssignment" ca WHERE ca."caseId" = c."id" AND ca."userId" = u."id")
        OR EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'director', 'ceo')))
  ) THEN RAISE(ABORT, 'P09_COMMENT_ACTOR_SCOPE_INVALID') END;
  SELECT CASE WHEN NEW."revisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ReportSectionRevision" WHERE "id" = NEW."revisionId" AND "sectionId" = NEW."sectionId"
  ) THEN RAISE(ABORT, 'P09_COMMENT_REVISION_SECTION_MISMATCH') END;
END;
CREATE TRIGGER "P09_comment_resolution_only"
BEFORE UPDATE ON "ReportSectionComment"
FOR EACH ROW WHEN NOT (
  OLD."isResolved" = 0 AND NEW."isResolved" = 1 AND NEW."resolvedById" IS NOT NULL AND NEW."resolvedAt" IS NOT NULL
  AND NEW."id" = OLD."id" AND NEW."sectionId" = OLD."sectionId" AND NEW."revisionId" IS OLD."revisionId"
  AND NEW."authorId" = OLD."authorId" AND NEW."commentType" = OLD."commentType"
  AND NEW."content" = OLD."content" AND NEW."createdAt" = OLD."createdAt"
) BEGIN SELECT RAISE(ABORT, 'P09_COMMENT_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER "P09_comment_resolver_scope"
BEFORE UPDATE OF "isResolved", "resolvedById", "resolvedAt" ON "ReportSectionComment"
FOR EACH ROW WHEN NEW."isResolved" = 1 BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ReportSection" s JOIN "Report" r ON r."id" = s."reportId"
    JOIN "CaseItem" c ON c."id" = r."caseId" JOIN "User" u ON u."id" = NEW."resolvedById"
    WHERE s."id" = NEW."sectionId" AND c."organizationId" = u."organizationId"
      AND (EXISTS (SELECT 1 FROM "CaseAssignment" ca WHERE ca."caseId" = c."id" AND ca."userId" = u."id")
        OR EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'director', 'ceo')))
  ) THEN RAISE(ABORT, 'P09_COMMENT_RESOLVER_SCOPE_INVALID') END;
END;
CREATE TRIGGER "P09_comment_delete_guard" BEFORE DELETE ON "ReportSectionComment"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_COMMENT_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER "P09_approval_insert_guard"
BEFORE INSERT ON "ReportSectionApproval"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ReportSection" s JOIN "Report" r ON r."id" = s."reportId"
    JOIN "CaseItem" c ON c."id" = r."caseId" JOIN "User" u ON u."id" = NEW."approverId"
    WHERE s."id" = NEW."sectionId" AND r."reportInstanceId" IS NOT NULL
      AND c."organizationId" = u."organizationId"
      AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'director', 'reviewer'))
      AND (EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'director'))
        OR EXISTS (SELECT 1 FROM "CaseAssignment" ca WHERE ca."caseId" = c."id" AND ca."userId" = u."id"))
  ) THEN RAISE(ABORT, 'P09_APPROVAL_ACTOR_SCOPE_INVALID') END;
  SELECT CASE WHEN NEW."eventNumber" <> COALESCE((SELECT MAX("eventNumber") + 1 FROM "ReportSectionApproval" WHERE "sectionId" = NEW."sectionId"), 1)
    THEN RAISE(ABORT, 'P09_APPROVAL_EVENT_NOT_MONOTONIC') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ReportSectionRevision" rv WHERE rv."id" = NEW."approvedRevisionId" AND rv."sectionId" = NEW."sectionId"
  ) THEN RAISE(ABORT, 'P09_APPROVAL_REVISION_SECTION_MISMATCH') END;
  SELECT CASE WHEN NEW."status" = 'APPROVED' AND EXISTS (
    SELECT 1 FROM "ReportSectionRevision" rv WHERE rv."id" = NEW."approvedRevisionId" AND rv."authorId" = NEW."approverId"
  ) THEN RAISE(ABORT, 'P09_SELF_APPROVAL_FORBIDDEN') END;
  SELECT CASE WHEN NEW."status" = 'APPROVED' AND EXISTS (
    SELECT 1 FROM "ReportSection" s WHERE s."id" = NEW."sectionId" AND s."status" = 'APPROVED'
  ) THEN RAISE(ABORT, 'P09_SECTION_ALREADY_APPROVED') END;
  SELECT CASE WHEN NEW."status" = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM "ReportSectionRevision" rv
    WHERE rv."id" = NEW."approvedRevisionId" AND rv."validationStatus" = 'VALID'
      AND rv."revisionNumber" = (SELECT MAX("revisionNumber") FROM "ReportSectionRevision" WHERE "sectionId" = NEW."sectionId")
  ) THEN RAISE(ABORT, 'P09_ONLY_LATEST_VALID_REVISION_APPROVABLE') END;
  SELECT CASE WHEN NEW."status" = 'APPROVED' AND EXISTS (
    SELECT 1 FROM "ReportSectionComment" c WHERE c."sectionId" = NEW."sectionId"
      AND c."commentType" = 'REVISION_REQUEST' AND c."isResolved" = 0
  ) THEN RAISE(ABORT, 'P09_UNRESOLVED_REVISION_REQUEST') END;
  SELECT CASE WHEN NEW."status" = 'UNLOCKED' AND NOT EXISTS (
    SELECT 1 FROM "ReportSection" s WHERE s."id" = NEW."sectionId" AND s."status" = 'APPROVED'
  ) THEN RAISE(ABORT, 'P09_UNLOCK_REQUIRES_APPROVED_SECTION') END;
  SELECT CASE WHEN NEW."status" = 'UNLOCKED' AND NOT EXISTS (
    SELECT 1 FROM "ReportSectionApproval" a WHERE a."sectionId" = NEW."sectionId"
      AND a."eventNumber" = NEW."eventNumber" - 1 AND a."status" = 'APPROVED'
      AND a."approvedRevisionId" = NEW."approvedRevisionId"
  ) THEN RAISE(ABORT, 'P09_UNLOCK_REQUIRES_LATEST_APPROVAL') END;
END;
CREATE TRIGGER "P09_approval_immutable_update" BEFORE UPDATE ON "ReportSectionApproval"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_APPROVAL_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER "P09_approval_immutable_delete" BEFORE DELETE ON "ReportSectionApproval"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_APPROVAL_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER "P09_report_section_content_guard"
BEFORE UPDATE OF "content" ON "ReportSection"
FOR EACH ROW WHEN NEW."content" IS NOT OLD."content" AND EXISTS (
  SELECT 1 FROM "Report" WHERE "id" = OLD."reportId" AND "reportInstanceId" IS NOT NULL
) BEGIN SELECT RAISE(ABORT, 'P09_DIRECT_SECTION_CONTENT_UPDATE_FORBIDDEN'); END;
CREATE TRIGGER "P09_report_section_status_insert_guard"
BEFORE INSERT ON "ReportSection"
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM "Report" WHERE "id" = NEW."reportId" AND "reportInstanceId" IS NOT NULL)
  AND NEW."status" NOT IN ('DRAFT', 'IN_REVIEW', 'REJECTED', 'APPROVED')
BEGIN SELECT RAISE(ABORT, 'P09_SECTION_STATUS_INVALID'); END;
CREATE TRIGGER "P09_report_section_status_transition_guard"
BEFORE UPDATE OF "status" ON "ReportSection"
FOR EACH ROW WHEN NEW."status" <> OLD."status" AND EXISTS (
  SELECT 1 FROM "Report" WHERE "id" = OLD."reportId" AND "reportInstanceId" IS NOT NULL
) BEGIN
  SELECT CASE WHEN NEW."status" NOT IN ('DRAFT', 'IN_REVIEW', 'REJECTED', 'APPROVED')
    THEN RAISE(ABORT, 'P09_SECTION_STATUS_INVALID') END;
  SELECT CASE WHEN NEW."status" = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM "ReportSectionApproval" a WHERE a."sectionId" = OLD."id"
      AND a."eventNumber" = (SELECT MAX("eventNumber") FROM "ReportSectionApproval" WHERE "sectionId" = OLD."id")
      AND a."status" = 'APPROVED'
  ) THEN RAISE(ABORT, 'P09_SECTION_APPROVAL_EVENT_REQUIRED') END;
  SELECT CASE WHEN OLD."status" = 'APPROVED' AND NEW."status" <> 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM "ReportSectionApproval" a WHERE a."sectionId" = OLD."id"
      AND a."eventNumber" = (SELECT MAX("eventNumber") FROM "ReportSectionApproval" WHERE "sectionId" = OLD."id")
      AND a."status" = 'UNLOCKED'
  ) THEN RAISE(ABORT, 'P09_SECTION_UNLOCK_EVENT_REQUIRED') END;
END;

CREATE TRIGGER "P09_merge_snapshot_insert_guard"
BEFORE INSERT ON "ReportMergeSnapshot"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "Report" WHERE "id" = NEW."reportId" AND "reportInstanceId" IS NOT NULL AND "deletedAt" IS NULL)
    THEN RAISE(ABORT, 'P09_MERGE_REQUIRES_REPORT_INSTANCE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "Report" r JOIN "CaseItem" c ON c."id" = r."caseId" JOIN "User" u ON u."id" = NEW."createdById"
    WHERE r."id" = NEW."reportId" AND c."organizationId" = u."organizationId"
      AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'director', 'pm'))
      AND (EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin', 'director'))
        OR EXISTS (SELECT 1 FROM "CaseAssignment" ca WHERE ca."caseId" = c."id" AND ca."userId" = u."id"))
  ) THEN RAISE(ABORT, 'P09_MERGE_ACTOR_SCOPE_INVALID') END;
  SELECT CASE WHEN NEW."snapshotVersion" <> COALESCE((SELECT MAX("snapshotVersion") + 1 FROM "ReportMergeSnapshot" WHERE "reportId" = NEW."reportId"), 1)
    THEN RAISE(ABORT, 'P09_MERGE_VERSION_NOT_MONOTONIC') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "ReportSection" WHERE "reportId" = NEW."reportId" AND "deletedAt" IS NULL)
    OR EXISTS (
      SELECT 1 FROM "ReportSection" s WHERE s."reportId" = NEW."reportId" AND s."deletedAt" IS NULL AND (
        s."status" <> 'APPROVED' OR NOT EXISTS (
          SELECT 1 FROM "ReportSectionApproval" a JOIN "ReportSectionRevision" rv ON rv."id" = a."approvedRevisionId"
          WHERE a."sectionId" = s."id"
            AND a."eventNumber" = (SELECT MAX("eventNumber") FROM "ReportSectionApproval" WHERE "sectionId" = s."id")
            AND a."status" = 'APPROVED' AND rv."sectionId" = s."id"
            AND rv."revisionNumber" = (SELECT MAX("revisionNumber") FROM "ReportSectionRevision" WHERE "sectionId" = s."id")
        )
      )
    ) THEN RAISE(ABORT, 'P09_MERGE_REQUIRES_LATEST_APPROVED_REVISIONS') END;
END;
CREATE TRIGGER "P09_merge_snapshot_immutable_update" BEFORE UPDATE ON "ReportMergeSnapshot"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_MERGE_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER "P09_merge_snapshot_immutable_delete" BEFORE DELETE ON "ReportMergeSnapshot"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P09_MERGE_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER "P09_report_history_delete_guard"
BEFORE DELETE ON "Report"
FOR EACH ROW WHEN OLD."reportInstanceId" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'P09_REPORT_HISTORY_DELETE_FORBIDDEN'); END;

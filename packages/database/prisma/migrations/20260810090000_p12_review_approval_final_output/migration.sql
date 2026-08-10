-- P12 Review, Approval & Final Output Migration

-- CreateTable
CREATE TABLE "ReportReviewRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "assignedReviewerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "idempotencyKey" TEXT,
    "idempotencyFingerprint" TEXT,
    "eventNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportReviewRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReviewRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReviewRequest_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReviewRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportReviewRequest_assignedReviewerId_fkey" FOREIGN KEY ("assignedReviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportFinalization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportTemplateVersionId" TEXT NOT NULL,
    "finalizedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FINALIZED',
    "canonicalSnapshotHash" TEXT NOT NULL,
    "sectionCount" INTEGER NOT NULL,
    "evidenceCount" INTEGER NOT NULL,
    "unresolvedFlagCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "idempotencyFingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportFinalization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalization_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalization_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalization_reportTemplateVersionId_fkey" FOREIGN KEY ("reportTemplateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalization_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportFinalizationSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "finalizationId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sectionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "approvedRevisionId" TEXT NOT NULL,
    "approvedRevisionHash" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportFinalizationSection_finalizationId_fkey" FOREIGN KEY ("finalizationId") REFERENCES "ReportFinalization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalizationSection_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalizationSection_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportFinalizationSection_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportOutputArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "finalizationId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "outputVersion" INTEGER NOT NULL DEFAULT 1,
    "documentVersionId" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL DEFAULT 'P12_GENERATOR_V1',
    "idempotencyKey" TEXT,
    "idempotencyFingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportOutputArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputArtifact_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputArtifact_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputArtifact_finalizationId_fkey" FOREIGN KEY ("finalizationId") REFERENCES "ReportFinalization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputArtifact_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportOutputDownload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "downloadedById" TEXT NOT NULL,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "downloadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportOutputDownload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputDownload_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputDownload_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ReportOutputArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportOutputDownload_downloadedById_fkey" FOREIGN KEY ("downloadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReportReviewRequest_organizationId_caseId_idx" ON "ReportReviewRequest"("organizationId", "caseId");
CREATE INDEX "ReportReviewRequest_reportId_idx" ON "ReportReviewRequest"("reportId");
CREATE INDEX "ReportReviewRequest_requestedById_idx" ON "ReportReviewRequest"("requestedById");
CREATE INDEX "ReportReviewRequest_assignedReviewerId_idx" ON "ReportReviewRequest"("assignedReviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFinalization_reportId_canonicalSnapshotHash_key" ON "ReportFinalization"("reportId", "canonicalSnapshotHash");
CREATE INDEX "ReportFinalization_organizationId_caseId_idx" ON "ReportFinalization"("organizationId", "caseId");
CREATE INDEX "ReportFinalization_reportId_idx" ON "ReportFinalization"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFinalizationSection_finalizationId_sectionNumber_key" ON "ReportFinalizationSection"("finalizationId", "sectionNumber");
CREATE INDEX "ReportFinalizationSection_finalizationId_idx" ON "ReportFinalizationSection"("finalizationId");
CREATE INDEX "ReportFinalizationSection_sectionId_idx" ON "ReportFinalizationSection"("sectionId");
CREATE INDEX "ReportFinalizationSection_approvedRevisionId_idx" ON "ReportFinalizationSection"("approvedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportOutputArtifact_storageKey_key" ON "ReportOutputArtifact"("storageKey");
CREATE UNIQUE INDEX "ReportOutputArtifact_finalizationId_format_key" ON "ReportOutputArtifact"("finalizationId", "format");
CREATE INDEX "ReportOutputArtifact_organizationId_caseId_idx" ON "ReportOutputArtifact"("organizationId", "caseId");
CREATE INDEX "ReportOutputArtifact_reportId_idx" ON "ReportOutputArtifact"("reportId");
CREATE INDEX "ReportOutputArtifact_finalizationId_idx" ON "ReportOutputArtifact"("finalizationId");
CREATE INDEX "ReportOutputArtifact_documentVersionId_idx" ON "ReportOutputArtifact"("documentVersionId");

-- CreateIndex
CREATE INDEX "ReportOutputDownload_organizationId_caseId_idx" ON "ReportOutputDownload"("organizationId", "caseId");
CREATE INDEX "ReportOutputDownload_artifactId_idx" ON "ReportOutputDownload"("artifactId");
CREATE INDEX "ReportOutputDownload_downloadedById_idx" ON "ReportOutputDownload"("downloadedById");

-- ----------------------------------------------------
-- DB Triggers for P12 Immutability & Safety
-- ----------------------------------------------------

CREATE TRIGGER "P12_review_request_insert_guard"
BEFORE INSERT ON "ReportReviewRequest"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."status" NOT IN ('PENDING', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED')
    OR NOT EXISTS (
      SELECT 1 FROM "Report" r
      JOIN "CaseItem" c ON c."id" = r."caseId"
      JOIN "User" u ON u."id" = NEW."requestedById"
      WHERE r."id" = NEW."reportId" AND c."id" = NEW."caseId"
        AND c."organizationId" = NEW."organizationId" AND u."organizationId" = NEW."organizationId"
        AND r."deletedAt" IS NULL AND c."deletedAt" IS NULL
    ) THEN RAISE(ABORT, 'P12_REVIEW_REQUEST_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P12_review_request_immutable_delete" BEFORE DELETE ON "ReportReviewRequest"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_REVIEW_REQUEST_IMMUTABLE'); END;

CREATE TRIGGER "P12_finalization_insert_guard"
BEFORE INSERT ON "ReportFinalization"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."status" <> 'FINALIZED'
    OR length(NEW."canonicalSnapshotHash") <> 64
    OR NEW."sectionCount" <= 0 OR NEW."unresolvedFlagCount" <> 0
    OR NOT EXISTS (
      SELECT 1 FROM "Report" r
      JOIN "CaseItem" c ON c."id" = r."caseId"
      JOIN "User" u ON u."id" = NEW."finalizedById"
      WHERE r."id" = NEW."reportId" AND c."id" = NEW."caseId"
        AND c."organizationId" = NEW."organizationId" AND u."organizationId" = NEW."organizationId"
        AND r."deletedAt" IS NULL AND c."deletedAt" IS NULL
    ) THEN RAISE(ABORT, 'P12_FINALIZATION_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P12_finalization_immutable_update" BEFORE UPDATE ON "ReportFinalization"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_FINALIZATION_IMMUTABLE'); END;

CREATE TRIGGER "P12_finalization_immutable_delete" BEFORE DELETE ON "ReportFinalization"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_FINALIZATION_IMMUTABLE'); END;

CREATE TRIGGER "P12_finalization_section_insert_guard"
BEFORE INSERT ON "ReportFinalizationSection"
FOR EACH ROW BEGIN
  SELECT CASE WHEN length(NEW."approvedRevisionHash") <> 64
    OR NEW."sectionNumber" <= 0
    OR NOT EXISTS (
      SELECT 1 FROM "ReportFinalization" f
      JOIN "ReportSection" s ON s."id" = NEW."sectionId"
      JOIN "ReportSectionRevision" r ON r."id" = NEW."approvedRevisionId" AND r."sectionId" = s."id"
      WHERE f."id" = NEW."finalizationId" AND f."reportId" = s."reportId"
        AND r."sha256" = NEW."approvedRevisionHash"
    ) THEN RAISE(ABORT, 'P12_FINALIZATION_SECTION_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P12_finalization_section_immutable_update" BEFORE UPDATE ON "ReportFinalizationSection"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_FINALIZATION_SECTION_IMMUTABLE'); END;

CREATE TRIGGER "P12_finalization_section_immutable_delete" BEFORE DELETE ON "ReportFinalizationSection"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_FINALIZATION_SECTION_IMMUTABLE'); END;

CREATE TRIGGER "P12_output_artifact_insert_guard"
BEFORE INSERT ON "ReportOutputArtifact"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."format" NOT IN ('DOCX', 'PDF')
    OR length(NEW."sha256") <> 64 OR NEW."byteSize" <= 0
    OR NOT EXISTS (
      SELECT 1 FROM "ReportFinalization" f
      JOIN "DocumentVersion" dv ON dv."id" = NEW."documentVersionId"
      WHERE f."id" = NEW."finalizationId" AND f."organizationId" = NEW."organizationId"
        AND f."caseId" = NEW."caseId" AND f."reportId" = NEW."reportId"
        AND dv."sha256" = NEW."sha256" AND dv."fileSize" = NEW."byteSize"
    ) THEN RAISE(ABORT, 'P12_OUTPUT_ARTIFACT_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P12_output_artifact_immutable_update" BEFORE UPDATE ON "ReportOutputArtifact"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_OUTPUT_ARTIFACT_IMMUTABLE'); END;

CREATE TRIGGER "P12_output_artifact_immutable_delete" BEFORE DELETE ON "ReportOutputArtifact"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_OUTPUT_ARTIFACT_IMMUTABLE'); END;

CREATE TRIGGER "P12_output_download_insert_guard"
BEFORE INSERT ON "ReportOutputDownload"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "ReportOutputArtifact" a
      WHERE a."id" = NEW."artifactId" AND a."organizationId" = NEW."organizationId"
        AND a."caseId" = NEW."caseId"
    ) THEN RAISE(ABORT, 'P12_OUTPUT_DOWNLOAD_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P12_output_download_immutable_update" BEFORE UPDATE ON "ReportOutputDownload"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_OUTPUT_DOWNLOAD_IMMUTABLE'); END;

CREATE TRIGGER "P12_output_download_immutable_delete" BEFORE DELETE ON "ReportOutputDownload"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P12_OUTPUT_DOWNLOAD_IMMUTABLE'); END;

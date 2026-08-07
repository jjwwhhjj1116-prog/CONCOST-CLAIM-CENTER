-- P07 lossless additive migration: proposal templates, immutable proposal versions,
-- review history and approved document provenance.
CREATE TABLE "ProposalTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "claimType" TEXT NOT NULL CHECK ("claimType" IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
    "description" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "placeholdersJson" TEXT NOT NULL CHECK (json_valid("placeholdersJson") AND json_type("placeholdersJson") = 'array'),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionSnapshot" INTEGER NOT NULL CHECK ("templateVersionSnapshot" > 0),
    "templateBodySnapshot" TEXT NOT NULL,
    "templatePlaceholdersSnapshotJson" TEXT NOT NULL CHECK (json_valid("templatePlaceholdersSnapshotJson") AND json_type("templatePlaceholdersSnapshotJson") = 'array'),
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED')),
    "currentVersionId" TEXT,
    "approvedVersionId" TEXT,
    "outputDocumentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Proposal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProposalTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Proposal_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "bodyText" TEXT NOT NULL,
    "structuredInputsJson" TEXT NOT NULL CHECK (json_valid("structuredInputsJson") AND json_type("structuredInputsJson") = 'object'),
    "renderedValuesJson" TEXT NOT NULL CHECK (json_valid("renderedValuesJson") AND json_type("renderedValuesJson") = 'object'),
    "missingFieldsJson" TEXT NOT NULL CHECK (json_valid("missingFieldsJson") AND json_type("missingFieldsJson") = 'array'),
    "generationMode" TEXT NOT NULL CHECK ("generationMode" IN ('MANUAL','AI')),
    "providerId" TEXT,
    "modelId" TEXT,
    "promptConfigVersion" TEXT,
    "inputSha256" TEXT NOT NULL CHECK (length("inputSha256") = 64 AND "inputSha256" NOT GLOB '*[^0-9a-f]*'),
    "generatedAt" DATETIME,
    "sourceDocumentVersionIdsJson" TEXT CHECK ("sourceDocumentVersionIdsJson" IS NULL OR (json_valid("sourceDocumentVersionIdsJson") AND json_type("sourceDocumentVersionIdsJson") = 'array')),
    "sha256" TEXT NOT NULL CHECK (length("sha256") = 64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("generationMode" = 'MANUAL' AND "providerId" IS NULL AND "modelId" IS NULL AND "promptConfigVersion" IS NULL AND "generatedAt" IS NULL)
        OR ("generationMode" = 'AI' AND "providerId" IS NOT NULL AND "modelId" IS NOT NULL AND "promptConfigVersion" IS NOT NULL AND "generatedAt" IS NOT NULL)),
    CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "Document" ADD COLUMN "proposalVersionId" TEXT REFERENCES "ProposalVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProposalReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL CHECK ("action" IN ('REQUEST_REVIEW','APPROVE','REJECT')),
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalReview_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProposalReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProposalReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ProposalTemplate_claimType_idx" ON "ProposalTemplate"("claimType");
CREATE INDEX "Proposal_caseId_deletedAt_idx" ON "Proposal"("caseId", "deletedAt");
CREATE INDEX "Proposal_templateId_idx" ON "Proposal"("templateId");
CREATE INDEX "Proposal_updatedById_idx" ON "Proposal"("updatedById");
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");
CREATE INDEX "ProposalVersion_proposalId_idx" ON "ProposalVersion"("proposalId");
CREATE UNIQUE INDEX "ProposalVersion_proposalId_versionNumber_key" ON "ProposalVersion"("proposalId", "versionNumber");
CREATE INDEX "Document_proposalVersionId_idx" ON "Document"("proposalVersionId");
CREATE INDEX "ProposalReview_proposalId_idx" ON "ProposalReview"("proposalId");
CREATE INDEX "ProposalReview_versionId_idx" ON "ProposalReview"("versionId");
CREATE INDEX "ProposalReview_reviewerId_idx" ON "ProposalReview"("reviewerId");

-- Proposal pointers, output linkage and lifecycle are enforced independently of the API.
CREATE TRIGGER "P07_proposal_integrity_insert" BEFORE INSERT ON "Proposal" FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."currentVersionId" IS NOT NULL THEN RAISE(ABORT, 'Initial proposal version pointer must be linked after version creation') END;
  SELECT CASE WHEN NEW."approvedVersionId" IS NOT NULL OR NEW."outputDocumentId" IS NOT NULL OR NEW."status" <> 'DRAFT'
    THEN RAISE(ABORT, 'New proposal must start in DRAFT without approved output') END;
END;

CREATE TRIGGER "P07_proposal_integrity_update" BEFORE UPDATE ON "Proposal" FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."caseId" IS NOT OLD."caseId" OR NEW."templateId" IS NOT OLD."templateId"
    OR NEW."templateVersionSnapshot" IS NOT OLD."templateVersionSnapshot"
    OR NEW."templateBodySnapshot" IS NOT OLD."templateBodySnapshot"
    OR NEW."templatePlaceholdersSnapshotJson" IS NOT OLD."templatePlaceholdersSnapshotJson"
    OR NEW."createdById" IS NOT OLD."createdById"
    THEN RAISE(ABORT, 'Proposal identity snapshot is immutable') END;
  SELECT CASE WHEN NEW."currentVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProposalVersion" v WHERE v."id" = NEW."currentVersionId" AND v."proposalId" = NEW."id"
  ) THEN RAISE(ABORT, 'Current proposal version must belong to the proposal') END;
  SELECT CASE WHEN NEW."approvedVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProposalVersion" v WHERE v."id" = NEW."approvedVersionId" AND v."proposalId" = NEW."id" AND v."isApproved" = 1
  ) THEN RAISE(ABORT, 'Approved proposal version must belong to the proposal and be approved') END;
  SELECT CASE WHEN OLD."approvedVersionId" IS NOT NULL AND NEW."approvedVersionId" IS NOT OLD."approvedVersionId"
    THEN RAISE(ABORT, 'Approved proposal version cannot be replaced or cleared') END;
  SELECT CASE WHEN NEW."outputDocumentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Document" d WHERE d."id" = NEW."outputDocumentId" AND d."caseId" = NEW."caseId"
      AND d."proposalVersionId" = NEW."approvedVersionId" AND d."deletedAt" IS NULL
  ) THEN RAISE(ABORT, 'Proposal output must be an active document for its approved version and case') END;
  SELECT CASE WHEN NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'DRAFT' AND NEW."status" = 'IN_REVIEW') OR
    (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('APPROVED','REJECTED')) OR
    (OLD."status" = 'REJECTED' AND NEW."status" = 'DRAFT')
  ) THEN RAISE(ABORT, 'Invalid proposal status transition') END;
  SELECT CASE WHEN NEW."status" = 'APPROVED' AND NEW."approvedVersionId" IS NULL
    THEN RAISE(ABORT, 'Approved proposal requires approvedVersionId') END;
  SELECT CASE WHEN NEW."status" <> 'APPROVED' AND NEW."approvedVersionId" IS NOT NULL
    THEN RAISE(ABORT, 'Only an approved proposal may hold approvedVersionId') END;
END;

-- Version snapshots can only undergo the one-way isApproved 0 -> 1 transition.
CREATE TRIGGER "P07_proposal_version_update_guard" BEFORE UPDATE ON "ProposalVersion" FOR EACH ROW WHEN NOT (
  OLD."isApproved" = 0 AND NEW."isApproved" = 1 AND
  NEW."id" IS OLD."id" AND NEW."proposalId" IS OLD."proposalId" AND NEW."versionNumber" IS OLD."versionNumber" AND
  NEW."bodyText" IS OLD."bodyText" AND NEW."structuredInputsJson" IS OLD."structuredInputsJson" AND
  NEW."renderedValuesJson" IS OLD."renderedValuesJson" AND NEW."missingFieldsJson" IS OLD."missingFieldsJson" AND
  NEW."generationMode" IS OLD."generationMode" AND NEW."providerId" IS OLD."providerId" AND
  NEW."modelId" IS OLD."modelId" AND NEW."promptConfigVersion" IS OLD."promptConfigVersion" AND
  NEW."inputSha256" IS OLD."inputSha256" AND NEW."generatedAt" IS OLD."generatedAt" AND
  NEW."sourceDocumentVersionIdsJson" IS OLD."sourceDocumentVersionIdsJson" AND NEW."sha256" IS OLD."sha256" AND
  NEW."createdById" IS OLD."createdById" AND NEW."createdAt" IS OLD."createdAt"
) BEGIN SELECT RAISE(ABORT, 'Proposal version snapshot is immutable'); END;

CREATE TRIGGER "P07_proposal_version_approval_guard" BEFORE UPDATE OF "isApproved" ON "ProposalVersion" FOR EACH ROW
WHEN NEW."isApproved" = 1 AND (json_array_length(NEW."missingFieldsJson") <> 0 OR NEW."generationMode" <> 'MANUAL' OR instr(NEW."bodyText", '[AI_DRAFT]') > 0)
BEGIN SELECT RAISE(ABORT, 'Only a complete human-edited proposal version can be approved'); END;

CREATE TRIGGER "P07_proposal_version_delete_guard" BEFORE DELETE ON "ProposalVersion" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Proposal version snapshot cannot be deleted'); END;

-- Review rows are append-only and must point to a version of the same proposal.
CREATE TRIGGER "P07_proposal_review_insert_guard" BEFORE INSERT ON "ProposalReview" FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ProposalVersion" v WHERE v."id" = NEW."versionId" AND v."proposalId" = NEW."proposalId"
  ) THEN RAISE(ABORT, 'Review version must belong to the proposal') END;
  SELECT CASE WHEN NEW."action" = 'APPROVE' AND EXISTS (
    SELECT 1 FROM "ProposalVersion" v WHERE v."id" = NEW."versionId" AND v."createdById" = NEW."reviewerId"
  ) THEN RAISE(ABORT, 'Proposal version creator cannot self-approve') END;
END;
CREATE TRIGGER "P07_proposal_review_update_guard" BEFORE UPDATE ON "ProposalReview" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Proposal review history is append-only'); END;
CREATE TRIGGER "P07_proposal_review_delete_guard" BEFORE DELETE ON "ProposalReview" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Proposal review history is append-only'); END;

-- Once a generated document is linked to an approved version, its linkage and rows are frozen.
CREATE TRIGGER "P07_output_document_update_guard" BEFORE UPDATE ON "Document" FOR EACH ROW
WHEN OLD."proposalVersionId" IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Approved proposal output document is immutable'); END;
CREATE TRIGGER "P07_output_document_delete_guard" BEFORE DELETE ON "Document" FOR EACH ROW
WHEN OLD."proposalVersionId" IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Approved proposal output document cannot be deleted'); END;

-- P11 Grounded AI Authoring Migration

-- CreateTable
CREATE TABLE "AiGroundingSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "policyHash" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "instructionHash" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiGroundingSelection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGroundingSelection_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGroundingSelection_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGroundingSelection_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiGroundingSelection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiGroundingItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selectionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "allowedAnchorsJson" TEXT NOT NULL DEFAULT '[]',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AiGroundingItem_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "AiGroundingSelection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiDraftSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selectionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "summaryText" TEXT NOT NULL,
    "promptMode" TEXT NOT NULL DEFAULT 'grounded_success',
    "idempotencyKey" TEXT NOT NULL,
    "idempotencyFingerprint" TEXT NOT NULL,
    "appliedRevisionId" TEXT,
    "appliedAt" DATETIME,
    "appliedActorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiDraftSuggestion_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "AiGroundingSelection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiGenerationRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ReportSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_appliedActorId_fkey" FOREIGN KEY ("appliedActorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiDraftSuggestion_appliedRevisionId_fkey" FOREIGN KEY ("appliedRevisionId") REFERENCES "ReportSectionRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiCitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suggestionId" TEXT NOT NULL,
    "targetClaimIndex" INTEGER NOT NULL,
    "claimText" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "anchorIndex" INTEGER NOT NULL,
    "anchorText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "conflictSourceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCitation_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AiDraftSuggestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable ReportSectionRevision
ALTER TABLE "ReportSectionRevision" ADD COLUMN "appliedSuggestionId" TEXT;

-- CreateIndex
CREATE INDEX "AiGroundingSelection_organizationId_caseId_idx" ON "AiGroundingSelection"("organizationId", "caseId");
CREATE INDEX "AiGroundingSelection_sectionId_idx" ON "AiGroundingSelection"("sectionId");
CREATE INDEX "AiGroundingSelection_manifestSha256_idx" ON "AiGroundingSelection"("manifestSha256");

-- CreateIndex
CREATE INDEX "AiGroundingItem_selectionId_idx" ON "AiGroundingItem"("selectionId");
CREATE UNIQUE INDEX "AiGroundingItem_selectionId_sourceType_sourceId_sourceVersionId_key" ON "AiGroundingItem"("selectionId", "sourceType", "sourceId", "sourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiDraftSuggestion_requestId_key" ON "AiDraftSuggestion"("requestId");
CREATE UNIQUE INDEX "AiDraftSuggestion_appliedRevisionId_key" ON "AiDraftSuggestion"("appliedRevisionId");
CREATE UNIQUE INDEX "AiDraftSuggestion_organizationId_caseId_sectionId_idempotencyKey_key" ON "AiDraftSuggestion"("organizationId", "caseId", "sectionId", "idempotencyKey");
CREATE INDEX "AiDraftSuggestion_selectionId_idx" ON "AiDraftSuggestion"("selectionId");
CREATE INDEX "AiDraftSuggestion_requestId_idx" ON "AiDraftSuggestion"("requestId");
CREATE INDEX "AiDraftSuggestion_sectionId_idx" ON "AiDraftSuggestion"("sectionId");

-- CreateIndex
CREATE INDEX "AiCitation_suggestionId_idx" ON "AiCitation"("suggestionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSectionRevision_appliedSuggestionId_key" ON "ReportSectionRevision"("appliedSuggestionId");

-- ----------------------------------------------------
-- DB Triggers for P11 Immutability & Security Guards
-- ----------------------------------------------------

CREATE TRIGGER P11_grounding_selection_immutable_update
BEFORE UPDATE ON AiGroundingSelection
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiGroundingSelection records are immutable and cannot be updated');
END;

CREATE TRIGGER P11_grounding_selection_immutable_delete
BEFORE DELETE ON AiGroundingSelection
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiGroundingSelection records are immutable and cannot be deleted');
END;

CREATE TRIGGER P11_grounding_item_immutable_update
BEFORE UPDATE ON AiGroundingItem
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiGroundingItem records are immutable and cannot be updated');
END;

CREATE TRIGGER P11_grounding_item_immutable_delete
BEFORE DELETE ON AiGroundingItem
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiGroundingItem records are immutable and cannot be deleted');
END;

CREATE TRIGGER P11_draft_suggestion_immutable_delete
BEFORE DELETE ON AiDraftSuggestion
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiDraftSuggestion records are immutable and cannot be deleted');
END;

CREATE TRIGGER P11_citation_immutable_update
BEFORE UPDATE ON AiCitation
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiCitation records are immutable and cannot be updated');
END;

CREATE TRIGGER P11_citation_immutable_delete
BEFORE DELETE ON AiCitation
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, 'P11: AiCitation records are immutable and cannot be deleted');
END;

CREATE TRIGGER P11_draft_suggestion_raw_secret_guard
BEFORE INSERT ON AiDraftSuggestion
FOR EACH ROW
WHEN NEW.summaryText LIKE '%sk-%' OR NEW.summaryText LIKE '%key-%' OR NEW.summaryText LIKE '%Bearer %'
BEGIN
    SELECT RAISE(FAIL, 'P11: Raw secret or API key string cannot be stored in suggestion summaryText');
END;

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
    "sourceVersionNumber" INTEGER NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "schemaVersion" TEXT NOT NULL DEFAULT 'P11_SUGGESTION_V1',
    "summaryText" TEXT NOT NULL DEFAULT '',
    "outputSha256" TEXT,
    "promptMode" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "idempotencyKey" TEXT NOT NULL,
    "idempotencyFingerprint" TEXT NOT NULL,
    "appliedRevisionId" TEXT,
    "appliedAt" DATETIME,
    "appliedActorId" TEXT,
    "applyIdempotencyKey" TEXT,
    "applyFingerprint" TEXT,
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

-- ----------------------------------------------------
-- DB Triggers for P11 Immutability & Security Guards
-- ----------------------------------------------------

CREATE TRIGGER "P11_grounding_selection_insert_guard"
BEFORE INSERT ON "AiGroundingSelection"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."status" <> 'LOCKED'
    OR length(NEW."manifestSha256") <> 64 OR length(NEW."policyHash") <> 64 OR length(NEW."instructionHash") <> 64
    OR NOT EXISTS (
      SELECT 1 FROM "Report" r
      JOIN "ReportSection" s ON s."reportId" = r."id"
      JOIN "CaseItem" c ON c."id" = r."caseId"
      JOIN "User" u ON u."id" = NEW."actorId"
      WHERE r."id" = NEW."reportId" AND s."id" = NEW."sectionId" AND c."id" = NEW."caseId"
        AND c."organizationId" = NEW."organizationId" AND u."organizationId" = NEW."organizationId"
        AND r."deletedAt" IS NULL AND s."deletedAt" IS NULL AND c."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" IN ('admin','pm','staff'))
        AND (EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" = 'admin')
          OR EXISTS (SELECT 1 FROM "CaseAssignment" ca WHERE ca."caseId" = c."id" AND ca."userId" = u."id"))
    ) THEN RAISE(ABORT, 'P11_GROUNDING_SELECTION_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P11_grounding_selection_immutable_update" BEFORE UPDATE ON "AiGroundingSelection"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_GROUNDING_SELECTION_IMMUTABLE'); END;
CREATE TRIGGER "P11_grounding_selection_immutable_delete" BEFORE DELETE ON "AiGroundingSelection"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_GROUNDING_SELECTION_IMMUTABLE'); END;

CREATE TRIGGER "P11_grounding_item_insert_guard"
BEFORE INSERT ON "AiGroundingItem"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."sourceType" NOT IN ('MATERIAL','MEETING')
    OR json_valid(NEW."allowedAnchorsJson") = 0 OR json_type(NEW."allowedAnchorsJson") <> 'array'
    OR json_array_length(NEW."allowedAnchorsJson") < 1 OR json_array_length(NEW."allowedAnchorsJson") > 50
    OR EXISTS (SELECT 1 FROM json_each(NEW."allowedAnchorsJson") WHERE type <> 'integer' OR value < 0)
    THEN RAISE(ABORT, 'P11_GROUNDING_ANCHORS_INVALID') END;
  SELECT CASE WHEN NEW."sourceType" = 'MATERIAL' AND NOT EXISTS (
    SELECT 1 FROM "AiGroundingSelection" gs
    JOIN "Document" d ON d."id" = NEW."sourceId"
    JOIN "DocumentVersion" dv ON dv."id" = NEW."sourceVersionId" AND dv."documentId" = d."id"
    WHERE gs."id" = NEW."selectionId" AND d."caseId" = gs."caseId" AND d."deletedAt" IS NULL
      AND dv."versionNumber" = NEW."sourceVersionNumber" AND dv."sha256" = NEW."sourceSha256"
  ) THEN RAISE(ABORT, 'P11_DOCUMENT_SOURCE_PROVENANCE_INVALID') END;
  SELECT CASE WHEN NEW."sourceType" = 'MEETING' AND NOT EXISTS (
    SELECT 1 FROM "AiGroundingSelection" gs JOIN "Meeting" m ON m."id" = NEW."sourceId"
    WHERE gs."id" = NEW."selectionId" AND m."caseId" = gs."caseId" AND m."status" = 'FINAL'
      AND m."rawTextSha256" IS NOT NULL AND m."version" = NEW."sourceVersionNumber"
      AND NEW."sourceVersionId" = m."id" || ':v' || m."version" AND m."rawTextSha256" = NEW."sourceSha256"
  ) THEN RAISE(ABORT, 'P11_MEETING_SOURCE_PROVENANCE_INVALID') END;
END;

CREATE TRIGGER "P11_grounding_item_immutable_update" BEFORE UPDATE ON "AiGroundingItem"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_GROUNDING_ITEM_IMMUTABLE'); END;
CREATE TRIGGER "P11_grounding_item_immutable_delete" BEFORE DELETE ON "AiGroundingItem"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_GROUNDING_ITEM_IMMUTABLE'); END;

CREATE TRIGGER "P11_draft_suggestion_insert_guard"
BEFORE INSERT ON "AiDraftSuggestion"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."status" <> 'PROCESSING' OR NEW."schemaVersion" <> 'P11_SUGGESTION_V1'
    OR NEW."summaryText" <> '' OR NEW."outputSha256" IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM "AiGroundingSelection" gs JOIN "AiGenerationRequest" ar ON ar."id" = NEW."requestId"
      WHERE gs."id" = NEW."selectionId" AND gs."organizationId" = NEW."organizationId"
        AND gs."caseId" = NEW."caseId" AND gs."reportId" = NEW."reportId" AND gs."sectionId" = NEW."sectionId"
        AND gs."actorId" = NEW."actorId" AND ar."organizationId" = NEW."organizationId"
        AND ar."caseId" = NEW."caseId" AND ar."userId" = NEW."actorId"
        AND ar."providerConfigId" = gs."providerId" AND ar."modelCode" = gs."modelCode"
    ) THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P11_draft_suggestion_update_guard"
BEFORE UPDATE ON "AiDraftSuggestion"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."selectionId" <> OLD."selectionId" OR NEW."requestId" <> OLD."requestId"
    OR NEW."organizationId" <> OLD."organizationId" OR NEW."caseId" <> OLD."caseId"
    OR NEW."reportId" <> OLD."reportId" OR NEW."sectionId" <> OLD."sectionId" OR NEW."actorId" <> OLD."actorId"
    OR NEW."schemaVersion" <> OLD."schemaVersion" OR NEW."promptMode" <> OLD."promptMode"
    OR NEW."idempotencyKey" <> OLD."idempotencyKey" OR NEW."idempotencyFingerprint" <> OLD."idempotencyFingerprint"
    THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_PROVENANCE_IMMUTABLE') END;
  SELECT CASE WHEN OLD."status" <> 'PROCESSING' AND (
      NEW."summaryText" <> OLD."summaryText" OR COALESCE(NEW."outputSha256", '') <> COALESCE(OLD."outputSha256", '')
    ) THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_OUTPUT_IMMUTABLE') END;
  SELECT CASE WHEN NOT (
      (OLD."status" = 'PROCESSING' AND NEW."status" IN ('GENERATED','BLOCKED','FAILED','CANCELED'))
      OR (OLD."status" = 'GENERATED' AND NEW."status" IN ('APPLIED','DISCARDED'))
      OR (OLD."status" = 'BLOCKED' AND NEW."status" = 'DISCARDED')
      OR (OLD."status" = 'FAILED' AND NEW."status" = 'DISCARDED')
      OR (OLD."status" = 'CANCELED' AND NEW."status" = 'DISCARDED')
    ) THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_STATE_INVALID') END;
  SELECT CASE WHEN NEW."status" IN ('GENERATED','BLOCKED')
      AND (length(NEW."summaryText") < 1 OR length(NEW."outputSha256") <> 64)
    THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_OUTPUT_INVALID') END;
  SELECT CASE WHEN NEW."status" = 'APPLIED' AND (
      NEW."appliedRevisionId" IS NULL OR NEW."appliedActorId" IS NULL OR NEW."appliedAt" IS NULL
      OR NEW."applyIdempotencyKey" IS NULL OR length(NEW."applyFingerprint") <> 64
      OR NOT EXISTS (
        SELECT 1 FROM "ReportSectionRevision" rv JOIN "User" u ON u."id" = NEW."appliedActorId"
        WHERE rv."id" = NEW."appliedRevisionId" AND rv."sectionId" = NEW."sectionId" AND rv."authorId" = NEW."appliedActorId"
          AND u."organizationId" = NEW."organizationId"
      )
    ) THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_APPLY_INVALID') END;
  SELECT CASE WHEN NEW."status" <> 'APPLIED' AND (NEW."appliedRevisionId" IS NOT NULL OR NEW."appliedActorId" IS NOT NULL OR NEW."appliedAt" IS NOT NULL
      OR NEW."applyIdempotencyKey" IS NOT NULL OR NEW."applyFingerprint" IS NOT NULL)
    THEN RAISE(ABORT, 'P11_DRAFT_SUGGESTION_APPLY_PROVENANCE_INVALID') END;
END;

CREATE TRIGGER "P11_draft_suggestion_immutable_delete" BEFORE DELETE ON "AiDraftSuggestion"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_DRAFT_SUGGESTION_IMMUTABLE'); END;

CREATE TRIGGER "P11_citation_insert_guard"
BEFORE INSERT ON "AiCitation"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."status" NOT IN ('VALID','REVIEW_REQUIRED','CONFLICT')
    OR NEW."targetClaimIndex" < 0 OR NEW."anchorIndex" < 0
    OR NOT EXISTS (
      SELECT 1 FROM "AiDraftSuggestion" ds JOIN "AiGroundingItem" gi ON gi."selectionId" = ds."selectionId"
      WHERE ds."id" = NEW."suggestionId" AND ds."status" IN ('GENERATED','BLOCKED')
        AND gi."sourceType" = NEW."sourceType" AND gi."sourceId" = NEW."sourceId"
        AND gi."sourceVersionId" = NEW."sourceVersionId" AND gi."sourceSha256" = NEW."sourceSha256"
        AND EXISTS (SELECT 1 FROM json_each(gi."allowedAnchorsJson") WHERE value = NEW."anchorIndex")
    ) THEN RAISE(ABORT, 'P11_CITATION_PROVENANCE_INVALID') END;
END;

CREATE TRIGGER "P11_citation_immutable_update" BEFORE UPDATE ON "AiCitation"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_CITATION_IMMUTABLE'); END;
CREATE TRIGGER "P11_citation_immutable_delete" BEFORE DELETE ON "AiCitation"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P11_CITATION_IMMUTABLE'); END;

CREATE TRIGGER "P11_draft_suggestion_secret_insert_guard"
BEFORE INSERT ON "AiDraftSuggestion"
FOR EACH ROW WHEN lower(NEW."summaryText") GLOB '*sk-*' OR lower(NEW."summaryText") GLOB '*bearer *'
  OR lower(NEW."summaryText") GLOB '*api_key*' OR lower(NEW."summaryText") GLOB '*apikey*'
BEGIN SELECT RAISE(ABORT, 'P11_SECRET_MATERIAL_FORBIDDEN'); END;

CREATE TRIGGER "P11_draft_suggestion_secret_update_guard"
BEFORE UPDATE ON "AiDraftSuggestion"
FOR EACH ROW WHEN lower(NEW."summaryText") GLOB '*sk-*' OR lower(NEW."summaryText") GLOB '*bearer *'
  OR lower(NEW."summaryText") GLOB '*api_key*' OR lower(NEW."summaryText") GLOB '*apikey*'
BEGIN SELECT RAISE(ABORT, 'P11_SECRET_MATERIAL_FORBIDDEN'); END;

CREATE TRIGGER "P11_citation_secret_guard"
BEFORE INSERT ON "AiCitation"
FOR EACH ROW WHEN lower(NEW."claimText" || ' ' || NEW."anchorText") GLOB '*sk-*'
  OR lower(NEW."claimText" || ' ' || NEW."anchorText") GLOB '*bearer *'
  OR lower(NEW."claimText" || ' ' || NEW."anchorText") GLOB '*api_key*'
BEGIN SELECT RAISE(ABORT, 'P11_SECRET_MATERIAL_FORBIDDEN'); END;

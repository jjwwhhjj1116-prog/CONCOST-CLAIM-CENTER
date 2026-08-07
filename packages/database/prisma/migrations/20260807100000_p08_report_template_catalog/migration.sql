-- P08 additive report-template catalog and immutable report snapshots.

CREATE TABLE "ReferenceInventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL UNIQUE,
    "sha256" TEXT NOT NULL CHECK (length("sha256") = 64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
    "fileSize" INTEGER NOT NULL CHECK ("fileSize" > 0),
    "scanStatus" TEXT NOT NULL DEFAULT 'UNSCANNED' CHECK ("scanStatus" IN ('UNSCANNED','SCANNED')),
    "approvalStatus" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK ("approvalStatus" IN ('UNCLASSIFIED','REVIEW_REQUIRED','HUMAN_APPROVED')),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL CHECK (length(trim("code")) BETWEEN 1 AND 80),
    "name" TEXT NOT NULL CHECK (length(trim("name")) BETWEEN 1 AND 200),
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','ARCHIVED')),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("organizationId", "code")
);

CREATE TABLE "ReportTemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" > 0),
    "rowVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("rowVersion" > 0),
    "name" TEXT NOT NULL CHECK (length(trim("name")) BETWEEN 1 AND 200),
    "companyForm" TEXT NOT NULL CHECK (length(trim("companyForm")) > 0),
    "tocStructureJson" TEXT NOT NULL CHECK (json_valid("tocStructureJson") AND json_type("tocStructureJson") = 'array' AND json_array_length("tocStructureJson") > 0),
    "requiredSectionsJson" TEXT NOT NULL CHECK (json_valid("requiredSectionsJson") AND json_type("requiredSectionsJson") = 'array'),
    "requiredEvidenceRulesJson" TEXT NOT NULL CHECK (json_valid("requiredEvidenceRulesJson") AND json_type("requiredEvidenceRulesJson") = 'array'),
    "blockSchemasJson" TEXT NOT NULL CHECK (json_valid("blockSchemasJson") AND json_type("blockSchemasJson") = 'object'),
    "contentSha256" TEXT NOT NULL CHECK (length("contentSha256") = 64 AND "contentSha256" NOT GLOB '*[^0-9a-f]*'),
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','HUMAN_APPROVED','ACTIVE','ARCHIVED')),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "activatedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportTemplateVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("templateId", "versionNumber"),
    CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById"),
    CHECK (
      ("status" = 'DRAFT' AND "approvedById" IS NULL AND "approvedAt" IS NULL AND "activatedAt" IS NULL AND "archivedAt" IS NULL)
      OR ("status" = 'HUMAN_APPROVED' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "activatedAt" IS NULL AND "archivedAt" IS NULL)
      OR ("status" = 'ACTIVE' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "archivedAt" IS NULL)
      OR ("status" = 'ARCHIVED' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "archivedAt" IS NOT NULL)
    )
);

CREATE TABLE "TemplateTypeMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateVersionId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL CHECK ("typeId" IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
    "kind" TEXT NOT NULL CHECK ("kind" IN ('PRIMARY','SECONDARY')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateTypeMapping_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("templateVersionId", "typeId")
);

CREATE UNIQUE INDEX "TemplateTypeMapping_one_primary"
ON "TemplateTypeMapping" ("templateVersionId") WHERE "kind" = 'PRIMARY';

CREATE TABLE "TemplateSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateVersionId" TEXT NOT NULL,
    "sectionNumber" INTEGER NOT NULL CHECK ("sectionNumber" > 0),
    "title" TEXT NOT NULL CHECK (length(trim("title")) > 0),
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "blockSchemaSnapshotJson" TEXT NOT NULL CHECK (json_valid("blockSchemaSnapshotJson") AND json_type("blockSchemaSnapshotJson") = 'object'),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateSection_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("templateVersionId", "sectionNumber")
);

CREATE TABLE "BlockDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL CHECK (length(trim("code")) > 0),
    "name" TEXT NOT NULL CHECK (length(trim("name")) > 0),
    "description" TEXT,
    "schemaJson" TEXT NOT NULL CHECK (json_valid("schemaJson") AND json_type("schemaJson") = 'object'),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','ARCHIVED')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    UNIQUE ("code", "version")
);

CREATE TABLE "TemplateSectionBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateSectionId" TEXT NOT NULL,
    "blockDefinitionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL CHECK ("position" > 0),
    "blockCodeSnapshot" TEXT NOT NULL,
    "blockVersionSnapshot" INTEGER NOT NULL CHECK ("blockVersionSnapshot" > 0),
    "blockSchemaSnapshotJson" TEXT NOT NULL CHECK (json_valid("blockSchemaSnapshotJson") AND json_type("blockSchemaSnapshotJson") = 'object'),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateSectionBlock_templateSectionId_fkey" FOREIGN KEY ("templateSectionId") REFERENCES "TemplateSection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TemplateSectionBlock_blockDefinitionId_fkey" FOREIGN KEY ("blockDefinitionId") REFERENCES "BlockDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("templateSectionId", "position")
);

CREATE TABLE "TemplateReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateVersionId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "fileIdSnapshot" TEXT NOT NULL,
    "sha256Snapshot" TEXT NOT NULL CHECK (length("sha256Snapshot") = 64 AND "sha256Snapshot" NOT GLOB '*[^0-9a-f]*'),
    "fileSizeSnapshot" INTEGER NOT NULL CHECK ("fileSizeSnapshot" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateReference_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TemplateReference_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "ReferenceInventory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("templateVersionId", "referenceId")
);

CREATE TABLE "ReportInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "templateCodeSnapshot" TEXT NOT NULL,
    "templateNameSnapshot" TEXT NOT NULL,
    "templateVersionNumberSnapshot" INTEGER NOT NULL CHECK ("templateVersionNumberSnapshot" > 0),
    "companyFormSnapshot" TEXT NOT NULL,
    "tocStructureSnapshotJson" TEXT NOT NULL CHECK (json_valid("tocStructureSnapshotJson") AND json_type("tocStructureSnapshotJson") = 'array'),
    "requiredSectionsSnapshotJson" TEXT NOT NULL CHECK (json_valid("requiredSectionsSnapshotJson") AND json_type("requiredSectionsSnapshotJson") = 'array'),
    "requiredEvidenceRulesSnapshotJson" TEXT NOT NULL CHECK (json_valid("requiredEvidenceRulesSnapshotJson") AND json_type("requiredEvidenceRulesSnapshotJson") = 'array'),
    "blockSchemasSnapshotJson" TEXT NOT NULL CHECK (json_valid("blockSchemasSnapshotJson") AND json_type("blockSchemasSnapshotJson") = 'object'),
    "referenceProvenanceSnapshotJson" TEXT NOT NULL CHECK (json_valid("referenceProvenanceSnapshotJson") AND json_type("referenceProvenanceSnapshotJson") = 'array'),
    "snapshotSha256" TEXT NOT NULL CHECK (length("snapshotSha256") = 64 AND "snapshotSha256" NOT GLOB '*[^0-9a-f]*'),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportInstance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportInstance_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportInstance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "Report" ADD COLUMN "reportInstanceId" TEXT;
CREATE UNIQUE INDEX "Report_reportInstanceId_key" ON "Report" ("reportInstanceId");

ALTER TABLE "ReportSection" ADD COLUMN "templateSectionIdSnapshot" TEXT;
ALTER TABLE "ReportSection" ADD COLUMN "sectionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReportSection" ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReportSection" ADD COLUMN "blockSchemaSnapshotJson" TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX "ReportSection_reportId_sectionNumber_key" ON "ReportSection" ("reportId", "sectionNumber");

CREATE INDEX "ReferenceInventory_approvalStatus_idx" ON "ReferenceInventory" ("approvalStatus");
CREATE INDEX "ReportTemplate_organizationId_status_idx" ON "ReportTemplate" ("organizationId", "status");
CREATE INDEX "ReportTemplateVersion_templateId_status_idx" ON "ReportTemplateVersion" ("templateId", "status");
CREATE INDEX "TemplateTypeMapping_typeId_kind_idx" ON "TemplateTypeMapping" ("typeId", "kind");
CREATE INDEX "TemplateSection_templateVersionId_idx" ON "TemplateSection" ("templateVersionId");
CREATE INDEX "TemplateSectionBlock_blockDefinitionId_idx" ON "TemplateSectionBlock" ("blockDefinitionId");
CREATE INDEX "TemplateReference_templateVersionId_idx" ON "TemplateReference" ("templateVersionId");
CREATE INDEX "BlockDefinition_code_status_idx" ON "BlockDefinition" ("code", "status");
CREATE INDEX "ReportInstance_organizationId_caseId_idx" ON "ReportInstance" ("organizationId", "caseId");
CREATE INDEX "ReportInstance_templateVersionId_idx" ON "ReportInstance" ("templateVersionId");

CREATE TRIGGER "P08_reference_identity_immutable"
BEFORE UPDATE OF "fileId", "sha256", "fileSize" ON "ReferenceInventory"
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'P08_REFERENCE_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER "P08_reference_state_transition"
BEFORE UPDATE OF "scanStatus", "approvalStatus", "version" ON "ReferenceInventory"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT (
    OLD."scanStatus" = NEW."scanStatus" OR (OLD."scanStatus" = 'UNSCANNED' AND NEW."scanStatus" = 'SCANNED')
  ) THEN RAISE(ABORT, 'P08_REFERENCE_SCAN_TRANSITION_INVALID') END;
  SELECT CASE WHEN NOT (
    OLD."approvalStatus" = NEW."approvalStatus"
    OR (OLD."approvalStatus" IN ('UNCLASSIFIED','REVIEW_REQUIRED') AND NEW."approvalStatus" = 'HUMAN_APPROVED')
  ) THEN RAISE(ABORT, 'P08_REFERENCE_APPROVAL_TRANSITION_INVALID') END;
  SELECT CASE WHEN NEW."version" <> OLD."version" + 1
    THEN RAISE(ABORT, 'P08_REFERENCE_VERSION_STALE') END;
  SELECT CASE WHEN NEW."approvalStatus" = 'HUMAN_APPROVED' AND NEW."scanStatus" <> 'SCANNED'
    THEN RAISE(ABORT, 'P08_UNSCANNED_REFERENCE_APPROVAL_FORBIDDEN') END;
END;

CREATE TRIGGER "P08_reference_delete_guard"
BEFORE DELETE ON "ReferenceInventory"
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'P08_REFERENCE_DELETE_FORBIDDEN');
END;

CREATE TRIGGER "P08_template_identity_immutable"
BEFORE UPDATE OF "organizationId", "code", "createdById", "createdAt" ON "ReportTemplate"
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'P08_TEMPLATE_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER "P08_template_version_content_immutable"
BEFORE UPDATE OF "templateId", "versionNumber", "name", "companyForm", "tocStructureJson", "requiredSectionsJson", "requiredEvidenceRulesJson", "blockSchemasJson", "contentSha256", "createdById", "createdAt" ON "ReportTemplateVersion"
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'P08_TEMPLATE_VERSION_CONTENT_IMMUTABLE');
END;

CREATE TRIGGER "P08_template_version_lifecycle_guard"
BEFORE UPDATE OF "status" ON "ReportTemplateVersion"
FOR EACH ROW WHEN NOT (
  (OLD."status" = 'DRAFT' AND NEW."status" = 'HUMAN_APPROVED')
  OR (OLD."status" = 'HUMAN_APPROVED' AND NEW."status" = 'ACTIVE')
  OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'ARCHIVED')
) BEGIN
  SELECT RAISE(ABORT, 'P08_TEMPLATE_VERSION_TRANSITION_INVALID');
END;

CREATE TRIGGER "P08_template_version_approval_guard"
BEFORE UPDATE OF "status", "approvedById", "approvedAt" ON "ReportTemplateVersion"
FOR EACH ROW WHEN NEW."status" = 'HUMAN_APPROVED'
BEGIN
  SELECT CASE WHEN NEW."approvedById" IS NULL OR NEW."approvedAt" IS NULL
    THEN RAISE(ABORT, 'P08_HUMAN_APPROVAL_REQUIRED') END;
  SELECT CASE WHEN NEW."approvedById" = OLD."createdById"
    THEN RAISE(ABORT, 'P08_CREATOR_SELF_APPROVAL_FORBIDDEN') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM "TemplateTypeMapping" WHERE "templateVersionId" = OLD."id" AND "kind" = 'PRIMARY') <> 1
    THEN RAISE(ABORT, 'P08_EXACTLY_ONE_PRIMARY_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "TemplateSection" WHERE "templateVersionId" = OLD."id")
    THEN RAISE(ABORT, 'P08_TEMPLATE_SECTION_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM "TemplateReference" tr
    JOIN "ReferenceInventory" ri ON ri."id" = tr."referenceId"
    WHERE tr."templateVersionId" = OLD."id"
      AND (ri."approvalStatus" <> 'HUMAN_APPROVED' OR tr."fileIdSnapshot" <> ri."fileId" OR tr."sha256Snapshot" <> ri."sha256" OR tr."fileSizeSnapshot" <> ri."fileSize")
  ) THEN RAISE(ABORT, 'P08_REFERENCE_PROVENANCE_NOT_APPROVED') END;
END;

CREATE TRIGGER "P08_template_version_activation_guard"
BEFORE UPDATE OF "status", "activatedAt" ON "ReportTemplateVersion"
FOR EACH ROW WHEN NEW."status" = 'ACTIVE'
BEGIN
  SELECT CASE WHEN NEW."activatedAt" IS NULL THEN RAISE(ABORT, 'P08_ACTIVATED_AT_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM "ReportTemplateVersion" other
    JOIN "ReportTemplate" other_template ON other_template."id" = other."templateId"
    JOIN "TemplateTypeMapping" other_mapping ON other_mapping."templateVersionId" = other."id" AND other_mapping."kind" = 'PRIMARY'
    JOIN "ReportTemplate" current_template ON current_template."id" = OLD."templateId"
    JOIN "TemplateTypeMapping" current_mapping ON current_mapping."templateVersionId" = OLD."id" AND current_mapping."kind" = 'PRIMARY'
    WHERE other."status" = 'ACTIVE' AND other."id" <> OLD."id"
      AND other_template."organizationId" = current_template."organizationId"
      AND other_mapping."typeId" = current_mapping."typeId"
  ) THEN RAISE(ABORT, 'P08_ACTIVE_TEMPLATE_ALREADY_EXISTS') END;
END;

CREATE TRIGGER "P08_template_version_delete_guard"
BEFORE DELETE ON "ReportTemplateVersion"
FOR EACH ROW BEGIN
  SELECT RAISE(ABORT, 'P08_TEMPLATE_VERSION_DELETE_FORBIDDEN');
END;

CREATE TRIGGER "P08_mapping_insert_guard"
BEFORE INSERT ON "TemplateTypeMapping"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW."typeId" = 'TYPE-05' THEN RAISE(ABORT, 'P08_TYPE05_TEMPLATE_MAPPING_FORBIDDEN') END;
  SELECT CASE WHEN (SELECT "status" FROM "ReportTemplateVersion" WHERE "id" = NEW."templateVersionId") <> 'DRAFT'
    THEN RAISE(ABORT, 'P08_MAPPING_ONLY_FOR_DRAFT') END;
END;

CREATE TRIGGER "P08_mapping_update_guard"
BEFORE UPDATE ON "TemplateTypeMapping"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_MAPPING_IMMUTABLE'); END;
CREATE TRIGGER "P08_mapping_delete_guard"
BEFORE DELETE ON "TemplateTypeMapping"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_MAPPING_DELETE_FORBIDDEN'); END;

CREATE TRIGGER "P08_section_insert_guard"
BEFORE INSERT ON "TemplateSection"
FOR EACH ROW WHEN (SELECT "status" FROM "ReportTemplateVersion" WHERE "id" = NEW."templateVersionId") <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'P08_SECTION_ONLY_FOR_DRAFT'); END;
CREATE TRIGGER "P08_section_update_guard"
BEFORE UPDATE ON "TemplateSection"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_TEMPLATE_SECTION_IMMUTABLE'); END;
CREATE TRIGGER "P08_section_delete_guard"
BEFORE DELETE ON "TemplateSection"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_TEMPLATE_SECTION_DELETE_FORBIDDEN'); END;

CREATE TRIGGER "P08_section_block_insert_guard"
BEFORE INSERT ON "TemplateSectionBlock"
FOR EACH ROW BEGIN
  SELECT CASE WHEN (SELECT v."status" FROM "TemplateSection" s JOIN "ReportTemplateVersion" v ON v."id" = s."templateVersionId" WHERE s."id" = NEW."templateSectionId") <> 'DRAFT'
    THEN RAISE(ABORT, 'P08_BLOCK_MAPPING_ONLY_FOR_DRAFT') END;
  SELECT CASE WHEN NEW."blockCodeSnapshot" <> (SELECT "code" FROM "BlockDefinition" WHERE "id" = NEW."blockDefinitionId")
    OR NEW."blockVersionSnapshot" <> (SELECT "version" FROM "BlockDefinition" WHERE "id" = NEW."blockDefinitionId")
    OR NEW."blockSchemaSnapshotJson" <> (SELECT "schemaJson" FROM "BlockDefinition" WHERE "id" = NEW."blockDefinitionId")
    THEN RAISE(ABORT, 'P08_BLOCK_PROVENANCE_MISMATCH') END;
END;
CREATE TRIGGER "P08_section_block_update_guard"
BEFORE UPDATE ON "TemplateSectionBlock"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_BLOCK_MAPPING_IMMUTABLE'); END;
CREATE TRIGGER "P08_section_block_delete_guard"
BEFORE DELETE ON "TemplateSectionBlock"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_BLOCK_MAPPING_DELETE_FORBIDDEN'); END;

CREATE TRIGGER "P08_reference_mapping_insert_guard"
BEFORE INSERT ON "TemplateReference"
FOR EACH ROW BEGIN
  SELECT CASE WHEN (SELECT "status" FROM "ReportTemplateVersion" WHERE "id" = NEW."templateVersionId") <> 'DRAFT'
    THEN RAISE(ABORT, 'P08_REFERENCE_ONLY_FOR_DRAFT') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "ReferenceInventory" ri WHERE ri."id" = NEW."referenceId"
      AND ri."approvalStatus" = 'HUMAN_APPROVED'
      AND ri."fileId" = NEW."fileIdSnapshot"
      AND ri."sha256" = NEW."sha256Snapshot"
      AND ri."fileSize" = NEW."fileSizeSnapshot"
  ) THEN RAISE(ABORT, 'P08_REFERENCE_PROVENANCE_MISMATCH') END;
END;
CREATE TRIGGER "P08_reference_mapping_update_guard"
BEFORE UPDATE ON "TemplateReference"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_REFERENCE_MAPPING_IMMUTABLE'); END;
CREATE TRIGGER "P08_reference_mapping_delete_guard"
BEFORE DELETE ON "TemplateReference"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_REFERENCE_MAPPING_DELETE_FORBIDDEN'); END;

CREATE TRIGGER "P08_block_definition_content_immutable"
BEFORE UPDATE OF "code", "name", "description", "schemaJson", "version", "createdAt" ON "BlockDefinition"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_BLOCK_DEFINITION_IMMUTABLE'); END;
CREATE TRIGGER "P08_block_definition_delete_guard"
BEFORE DELETE ON "BlockDefinition"
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM "TemplateSectionBlock" WHERE "blockDefinitionId" = OLD."id")
BEGIN SELECT RAISE(ABORT, 'P08_USED_BLOCK_DELETE_FORBIDDEN'); END;

CREATE TRIGGER "P08_report_instance_insert_guard"
BEFORE INSERT ON "ReportInstance"
FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "CaseItem" c
    JOIN "ReportTemplateVersion" v ON v."id" = NEW."templateVersionId" AND v."status" = 'ACTIVE'
    JOIN "ReportTemplate" t ON t."id" = v."templateId"
    JOIN "TemplateTypeMapping" m ON m."templateVersionId" = v."id" AND m."kind" = 'PRIMARY'
    WHERE c."id" = NEW."caseId" AND c."deletedAt" IS NULL
      AND c."organizationId" = NEW."organizationId"
      AND t."organizationId" = NEW."organizationId"
      AND m."typeId" = c."claimType"
      AND c."claimType" <> 'TYPE-05'
  ) THEN RAISE(ABORT, 'P08_REPORT_INSTANCE_SCOPE_OR_TYPE_INVALID') END;
  SELECT CASE WHEN NEW."organizationId" <> (SELECT "organizationId" FROM "User" WHERE "id" = NEW."createdById")
    THEN RAISE(ABORT, 'P08_REPORT_INSTANCE_ACTOR_SCOPE_INVALID') END;
END;

CREATE TRIGGER "P08_report_instance_snapshot_immutable"
BEFORE UPDATE OF "organizationId", "caseId", "templateVersionId", "createdById", "templateCodeSnapshot", "templateNameSnapshot", "templateVersionNumberSnapshot", "companyFormSnapshot", "tocStructureSnapshotJson", "requiredSectionsSnapshotJson", "requiredEvidenceRulesSnapshotJson", "blockSchemasSnapshotJson", "referenceProvenanceSnapshotJson", "snapshotSha256", "createdAt" ON "ReportInstance"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_REPORT_INSTANCE_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER "P08_report_instance_delete_guard"
BEFORE DELETE ON "ReportInstance"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'P08_REPORT_INSTANCE_DELETE_FORBIDDEN'); END;

CREATE TRIGGER "P08_report_instance_link_insert"
BEFORE INSERT ON "Report"
FOR EACH ROW WHEN NEW."reportInstanceId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "ReportInstance" ri WHERE ri."id" = NEW."reportInstanceId" AND ri."caseId" = NEW."caseId"
) BEGIN SELECT RAISE(ABORT, 'P08_REPORT_INSTANCE_REPORT_CASE_MISMATCH'); END;

CREATE TRIGGER "P08_report_instance_link_update"
BEFORE UPDATE OF "reportInstanceId", "caseId" ON "Report"
FOR EACH ROW WHEN NEW."reportInstanceId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "ReportInstance" ri WHERE ri."id" = NEW."reportInstanceId" AND ri."caseId" = NEW."caseId"
) BEGIN SELECT RAISE(ABORT, 'P08_REPORT_INSTANCE_REPORT_CASE_MISMATCH'); END;

CREATE TRIGGER "P08_report_section_snapshot_immutable"
BEFORE UPDATE OF "reportId", "templateSectionIdSnapshot", "sectionNumber", "title", "isRequired", "blockSchemaSnapshotJson" ON "ReportSection"
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM "Report" WHERE "id" = OLD."reportId" AND "reportInstanceId" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'P08_REPORT_SECTION_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER "P08_report_section_delete_guard"
BEFORE DELETE ON "ReportSection"
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM "Report" WHERE "id" = OLD."reportId" AND "reportInstanceId" IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'P08_REPORT_SECTION_DELETE_FORBIDDEN'); END;

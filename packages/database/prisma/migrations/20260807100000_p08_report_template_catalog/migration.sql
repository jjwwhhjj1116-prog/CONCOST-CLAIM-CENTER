-- CreateTable
CREATE TABLE "ReferenceInventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'UNSCANNED',
    "approvalStatus" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReportTemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "companyForm" TEXT NOT NULL,
    "tocStructureJson" TEXT NOT NULL,
    "requiredSectionsJson" TEXT NOT NULL,
    "requiredEvidenceRulesJson" TEXT NOT NULL,
    "blockSchemasJson" TEXT NOT NULL,
    "referenceFileIdsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportTemplateVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateTypeMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateVersionId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateTypeMapping_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateVersionId" TEXT NOT NULL,
    "sectionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "defaultBlocksJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemplateSection_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlockDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schemaJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReportInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "templateVersionNumberSnapshot" INTEGER NOT NULL,
    "companyFormSnapshot" TEXT NOT NULL,
    "tocStructureSnapshotJson" TEXT NOT NULL,
    "requiredSectionsSnapshotJson" TEXT NOT NULL,
    "requiredEvidenceRulesSnapshotJson" TEXT NOT NULL,
    "blockSchemasSnapshotJson" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportInstance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CaseItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportInstance_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ReportTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReportInstance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndexes
CREATE UNIQUE INDEX "ReferenceInventory_fileId_key" ON "ReferenceInventory"("fileId");
CREATE INDEX "ReferenceInventory_fileId_idx" ON "ReferenceInventory"("fileId");
CREATE INDEX "ReferenceInventory_approvalStatus_idx" ON "ReferenceInventory"("approvalStatus");

CREATE UNIQUE INDEX "ReportTemplate_code_key" ON "ReportTemplate"("code");
CREATE INDEX "ReportTemplate_code_idx" ON "ReportTemplate"("code");

CREATE INDEX "ReportTemplateVersion_templateId_idx" ON "ReportTemplateVersion"("templateId");
CREATE INDEX "ReportTemplateVersion_status_idx" ON "ReportTemplateVersion"("status");
CREATE UNIQUE INDEX "ReportTemplateVersion_templateId_versionNumber_key" ON "ReportTemplateVersion"("templateId", "versionNumber");

CREATE INDEX "TemplateTypeMapping_templateVersionId_idx" ON "TemplateTypeMapping"("templateVersionId");
CREATE INDEX "TemplateTypeMapping_typeId_kind_idx" ON "TemplateTypeMapping"("typeId", "kind");
CREATE UNIQUE INDEX "TemplateTypeMapping_templateVersionId_typeId_key" ON "TemplateTypeMapping"("templateVersionId", "typeId");

CREATE INDEX "TemplateSection_templateVersionId_idx" ON "TemplateSection"("templateVersionId");
CREATE UNIQUE INDEX "TemplateSection_templateVersionId_sectionNumber_key" ON "TemplateSection"("templateVersionId", "sectionNumber");

CREATE UNIQUE INDEX "BlockDefinition_code_key" ON "BlockDefinition"("code");

CREATE INDEX "ReportInstance_caseId_idx" ON "ReportInstance"("caseId");
CREATE INDEX "ReportInstance_templateVersionId_idx" ON "ReportInstance"("templateVersionId");
CREATE INDEX "ReportInstance_createdById_idx" ON "ReportInstance"("createdById");

-- AlterTable Report and ReportSection
ALTER TABLE "Report" ADD COLUMN "reportInstanceId" TEXT;
CREATE INDEX "Report_reportInstanceId_idx" ON "Report"("reportInstanceId");

ALTER TABLE "ReportSection" ADD COLUMN "sectionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ReportSection" ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT false;

-- SQLite Triggers for DB Immutability & Self-Approval Prevention

-- 1. Prevent UPDATE of approved or active ReportTemplateVersion
CREATE TRIGGER "P08_report_template_version_no_update"
BEFORE UPDATE ON "ReportTemplateVersion"
FOR EACH ROW
WHEN OLD."status" IN ('HUMAN_APPROVED', 'ACTIVE', 'ARCHIVED') AND OLD."status" = NEW."status"
BEGIN
  SELECT RAISE(ABORT, 'Approved or Active template version cannot be updated');
END;

-- 2. Prevent DELETE of approved or active ReportTemplateVersion
CREATE TRIGGER "P08_report_template_version_no_delete"
BEFORE DELETE ON "ReportTemplateVersion"
FOR EACH ROW
WHEN OLD."status" IN ('HUMAN_APPROVED', 'ACTIVE', 'ARCHIVED')
BEGIN
  SELECT RAISE(ABORT, 'Approved or Active template version cannot be deleted');
END;

-- 3. Creator self-approval prevention trigger
CREATE TRIGGER "P08_report_template_version_no_self_approval"
BEFORE UPDATE ON "ReportTemplateVersion"
FOR EACH ROW
WHEN NEW."approvedById" IS NOT NULL AND OLD."createdById" = NEW."approvedById"
BEGIN
  SELECT RAISE(ABORT, 'Creator self-approval of template version is forbidden');
END;

-- 4. Single PRIMARY type mapping per version trigger
CREATE TRIGGER "P08_template_type_mapping_single_primary"
BEFORE INSERT ON "TemplateTypeMapping"
FOR EACH ROW
WHEN NEW."kind" = 'PRIMARY' AND (
  SELECT COUNT(*) FROM "TemplateTypeMapping"
  WHERE "templateVersionId" = NEW."templateVersionId" AND "kind" = 'PRIMARY'
) > 0
BEGIN
  SELECT RAISE(ABORT, 'A template version can have at most one PRIMARY type mapping');
END;

-- 5. Prevent immutable snapshot tampering in ReportInstance
CREATE TRIGGER "P08_report_instance_no_snapshot_update"
BEFORE UPDATE OF "companyFormSnapshot", "tocStructureSnapshotJson", "requiredSectionsSnapshotJson", "requiredEvidenceRulesSnapshotJson", "blockSchemasSnapshotJson", "templateVersionId" ON "ReportInstance"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ReportInstance template snapshot is immutable and cannot be updated');
END;

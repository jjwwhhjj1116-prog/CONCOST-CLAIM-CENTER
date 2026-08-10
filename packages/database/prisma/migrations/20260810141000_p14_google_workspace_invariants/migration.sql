-- P14 corrective, additive hardening migration. The original P14 migration is retained verbatim.
-- Fail closed before changing a populated database. The surrounding migration runner
-- wraps this entire file in BEGIN IMMEDIATE/ROLLBACK.
CREATE TEMP TABLE "_p14_invariant_preflight" (
  "ok" INTEGER NOT NULL CHECK ("ok" = 1)
);
INSERT INTO "_p14_invariant_preflight"("ok")
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pragma_foreign_key_check
) OR EXISTS (
  SELECT 1 FROM "GoogleWorkspaceConnection" c
  LEFT JOIN "User" u ON u."id" = c."createdById"
  WHERE u."id" IS NULL OR u."organizationId" <> c."organizationId"
     OR NOT EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = c."createdById" AND ur."roleId" = 'admin')
     OR NOT (
       c."secretRef" = 'LOCAL_FAKE_GOOGLE'
       OR (c."secretRef" GLOB 'ENV_*' AND length(c."secretRef") > 4 AND c."secretRef" NOT GLOB '*[^A-Z0-9_]*')
       OR (c."secretRef" GLOB 'SECREF_*' AND length(c."secretRef") > 7 AND c."secretRef" NOT GLOB '*[^A-Z0-9_-]*')
       OR (c."secretRef" GLOB 'sec-ref-google-*' AND length(c."secretRef") > 15 AND substr(c."secretRef", 16) NOT GLOB '*[^A-Za-z0-9_-]*')
     )
     OR c."status" NOT IN ('CONNECTED', 'EXPIRED', 'RECONSENT_REQUIRED', 'DISCONNECTED')
     OR lower(c."secretRef") LIKE '%ya29.%'
     OR lower(c."secretRef") GLOB '*access_token*'
     OR lower(c."secretRef") GLOB '*refresh_token*'
     OR lower(c."secretRef") GLOB '*client_secret*'
     OR json_valid(c."grantedScopesJson") = 0
     OR json_type(c."grantedScopesJson") <> 'array'
     OR lower(c."grantedScopesJson") LIKE '%ya29.%'
     OR lower(c."grantedScopesJson") GLOB '*access_token*'
     OR lower(c."grantedScopesJson") GLOB '*refresh_token*'
     OR lower(c."grantedScopesJson") GLOB '*client_secret*'
     OR EXISTS (
       SELECT 1 FROM json_each(CASE WHEN json_valid(c."grantedScopesJson") THEN c."grantedScopesJson" ELSE '[]' END) granted
       WHERE granted.value NOT IN (
         'https://www.googleapis.com/auth/drive.file',
         'https://www.googleapis.com/auth/gmail.readonly',
         'https://www.googleapis.com/auth/calendar.events',
         'https://www.googleapis.com/auth/documents',
         'https://www.googleapis.com/auth/spreadsheets.readonly'
       )
     )
) OR EXISTS (
  SELECT 1 FROM "GoogleWorkspaceConnection" c
  WHERE c."status" = 'CONNECTED' AND (
    c."tokenExpiresAt" IS NULL
    OR (SELECT count(*) FROM json_each(c."grantedScopesJson")) <> 5
    OR (SELECT count(DISTINCT value) FROM json_each(c."grantedScopesJson")) <> 5
    OR EXISTS (
      SELECT 1 FROM (
        SELECT 'https://www.googleapis.com/auth/drive.file' AS scope
        UNION ALL SELECT 'https://www.googleapis.com/auth/gmail.readonly'
        UNION ALL SELECT 'https://www.googleapis.com/auth/calendar.events'
        UNION ALL SELECT 'https://www.googleapis.com/auth/documents'
        UNION ALL SELECT 'https://www.googleapis.com/auth/spreadsheets.readonly'
      ) required
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(c."grantedScopesJson") THEN c."grantedScopesJson" ELSE '[]' END) granted
        WHERE granted.value = required.scope
      )
    )
  )
) OR EXISTS (
  SELECT 1 FROM "GoogleOAuthState" s
  LEFT JOIN "User" u ON u."id" = s."actorId"
  WHERE u."id" IS NULL OR u."organizationId" <> s."organizationId"
     OR NOT EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = s."actorId" AND ur."roleId" = 'admin')
     OR length(s."stateHash") <> 64 OR s."stateHash" GLOB '*[^0-9a-f]*'
     OR s."redirectTarget" <> '/integrations/google'
) OR EXISTS (
  SELECT 1 FROM "GoogleSyncOperation" o
  LEFT JOIN "User" u ON u."id" = o."actorId"
  LEFT JOIN "CaseItem" c ON c."id" = o."caseId"
  WHERE u."id" IS NULL OR u."organizationId" <> o."organizationId"
     OR (o."caseId" IS NOT NULL AND (c."id" IS NULL OR c."organizationId" <> o."organizationId" OR c."deletedAt" IS NOT NULL))
     OR (o."caseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CaseAssignment" a WHERE a."caseId" = o."caseId" AND a."userId" = o."actorId"))
     OR (o."caseId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "UserRole" ur WHERE ur."userId" = o."actorId" AND ur."roleId" IN ('ceo', 'director', 'pm', 'staff', 'reviewer', 'admin')
     ))
     OR (o."caseId" IS NOT NULL AND o."operationKind" = 'CALENDAR_EVENT' AND NOT EXISTS (
       SELECT 1 FROM "UserRole" ur WHERE ur."userId" = o."actorId" AND ur."roleId" IN ('ceo', 'director', 'pm', 'admin')
     ))
     OR (o."operationKind" = 'CONNECTION_TEST' AND NOT EXISTS (
       SELECT 1 FROM "UserRole" ur WHERE ur."userId" = o."actorId" AND ur."roleId" = 'admin'
     ))
     OR o."status" NOT IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED', 'RECONCILED_NO_SIDE_EFFECT')
     OR o."operationKind" NOT IN ('CONNECTION_TEST','DRIVE_FOLDER','GMAIL_IMPORT','CALENDAR_EVENT','DOCS_EXPORT','SHEETS_IMPORT')
     OR (o."operationKind" = 'CONNECTION_TEST' AND o."caseId" IS NOT NULL)
     OR (o."operationKind" <> 'CONNECTION_TEST' AND o."caseId" IS NULL)
     OR length(o."requestFingerprint") <> 64 OR o."requestFingerprint" GLOB '*[^0-9a-f]*'
     OR (o."caseId" IS NOT NULL AND (o."idempotencyKey" IS NULL OR length(o."idempotencyKey") < 8 OR length(o."idempotencyKey") > 120 OR o."idempotencyKey" GLOB '*[^A-Za-z0-9._:-]*'))
) OR EXISTS (
  SELECT 1 FROM "GoogleSyncAttempt" a
  LEFT JOIN "GoogleSyncOperation" o ON o."id" = a."operationId"
  WHERE o."id" IS NULL
     OR a."attemptNumber" < 1 OR a."attemptNumber" > 3
     OR a."durationMs" < 0 OR a."durationMs" > 2147483647
     OR a."responseClass" NOT IN ('SUCCESS','DUPLICATE_REPLAY','BAD_SCOPE','TOKEN_EXPIRED','RECONSENT_REQUIRED','RATE_LIMIT_RETRY_AFTER','SERVER_ERROR','TIMEOUT','USER_CANCEL','MALFORMED_PROVIDER_RESPONSE','REVOKE_FAILURE')
     OR lower(coalesce(a."redactedError", '')) LIKE '%ya29.%'
     OR lower(coalesce(a."redactedError", '')) GLOB '*access_token*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*refresh_token*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*client_secret*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*accesstoken[=:]*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*refresh-token[=:]*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*client secret[=:]*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*authorization_code[=:]*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*privatekey[=:]*'
     OR lower(coalesce(a."redactedError", '')) GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
     OR EXISTS (
       SELECT 1 FROM json_tree(CASE WHEN json_valid(coalesce(a."redactedError", '')) THEN a."redactedError" ELSE '{}' END)
       WHERE lower(coalesce(key, '')) GLOB '*access*token*'
          OR lower(coalesce(key, '')) GLOB '*refresh*token*'
          OR lower(coalesce(key, '')) GLOB '*client*secret*'
          OR lower(coalesce(key, '')) GLOB '*authorization*code*'
          OR lower(coalesce(key, '')) GLOB '*private*key*'
          OR lower(coalesce(key, '')) GLOB '*bearer*'
     )
) OR EXISTS (
  SELECT 1 FROM "GoogleResourceLink" r
  LEFT JOIN "CaseItem" c ON c."id" = r."caseId"
  LEFT JOIN "GoogleSyncOperation" o ON o."id" = r."operationId"
  WHERE r."caseId" IS NULL OR r."operationId" IS NULL
     OR c."id" IS NULL OR c."organizationId" <> r."organizationId" OR c."deletedAt" IS NOT NULL
     OR o."id" IS NULL OR o."organizationId" <> r."organizationId" OR o."caseId" <> r."caseId" OR o."status" <> 'SUCCESS'
     OR NOT (
       (r."entityType" = 'CASE_DRIVE_FOLDER' AND o."operationKind" = 'DRIVE_FOLDER')
       OR (r."entityType" = 'CALENDAR_EVENT' AND o."operationKind" = 'CALENDAR_EVENT')
       OR (r."entityType" = 'DOCS_EXPORT' AND o."operationKind" = 'DOCS_EXPORT')
       OR (r."entityType" = 'GMAIL_ATTACHMENT' AND o."operationKind" = 'GMAIL_IMPORT')
       OR (r."entityType" = 'SHEETS_RANGE' AND o."operationKind" = 'SHEETS_IMPORT')
     )
     OR json_valid(r."resourceMetadataJson") = 0
     OR lower(r."resourceMetadataJson") LIKE '%ya29.%'
     OR lower(r."resourceMetadataJson") GLOB '*access_token*'
     OR lower(r."resourceMetadataJson") GLOB '*refresh_token*'
     OR lower(r."resourceMetadataJson") GLOB '*client_secret*'
     OR EXISTS (
       SELECT 1 FROM json_tree(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END)
       WHERE lower(coalesce(key, '')) GLOB '*access*token*'
          OR lower(coalesce(key, '')) GLOB '*refresh*token*'
          OR lower(coalesce(key, '')) GLOB '*client*secret*'
          OR lower(coalesce(key, '')) GLOB '*authorization*code*'
          OR lower(coalesce(key, '')) GLOB '*private*key*'
          OR lower(coalesce(key, '')) GLOB '*bearer*'
     )
     OR lower(r."resourceMetadataJson") GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
     OR lower(r."resourceMetadataJson") GLOB '*-----begin*private*key-----*'
     OR r."entityType" NOT IN ('CASE_DRIVE_FOLDER','CALENDAR_EVENT','DOCS_EXPORT','GMAIL_ATTACHMENT','SHEETS_RANGE')
     OR length(r."internalEntityId") = 0 OR length(r."externalResourceId") = 0
     OR (r."entityType" = 'CASE_DRIVE_FOLDER' AND r."internalEntityId" <> r."caseId")
     OR (r."entityType" = 'GMAIL_ATTACHMENT' AND NOT EXISTS (
       SELECT 1 FROM "DocumentVersion" dv
       JOIN "Document" d ON d."id" = dv."documentId"
       JOIN "GoogleImportSnapshot" s
         ON s."organizationId" = r."organizationId"
        AND s."caseId" = r."caseId"
        AND s."operationId" = r."operationId"
        AND s."sourceType" = 'GMAIL_ATTACHMENT'
        AND s."externalResourceId" = r."externalResourceId"
       WHERE dv."id" = r."internalEntityId"
         AND d."caseId" = r."caseId"
         AND d."deletedAt" IS NULL
         AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.documentVersionId') = r."internalEntityId"
         AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.documentVersionId') = r."internalEntityId"
         AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.attachmentId') = r."externalResourceId"
      ))
      OR (r."entityType" = 'DOCS_EXPORT' AND NOT EXISTS (
        SELECT 1 FROM "Meeting" m
        JOIN "GoogleImportSnapshot" s
          ON s."id" = json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.snapshotId')
        WHERE m."id" = json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.meetingId')
          AND m."caseId" = r."caseId"
          AND json_type(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.versionNumber') = 'integer'
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.versionNumber') >= 1
          AND r."internalEntityId" = m."id" || ':v' || json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.versionNumber')
          AND s."organizationId" = r."organizationId"
          AND s."caseId" = r."caseId"
          AND s."operationId" = r."operationId"
          AND s."sourceType" = 'DOCS_TEXT'
          AND s."externalResourceId" = r."externalResourceId"
          AND s."sha256" = json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.contentSha256')
          AND s."version" = json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.versionNumber')
          AND s."createdById" = o."actorId"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.meetingId') = m."id"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.meetingVersion') = s."version"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.contentSha256') = s."sha256"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.exportedDocumentId') = s."externalResourceId"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.exportedBy') = s."createdById"
      ))
      OR (r."entityType" = 'SHEETS_RANGE' AND NOT EXISTS (
        SELECT 1 FROM "GoogleImportSnapshot" s
        WHERE s."id" = r."internalEntityId" AND s."caseId" = r."caseId"
          AND s."organizationId" = r."organizationId" AND s."operationId" = r."operationId"
          AND s."sourceType" = 'SHEETS_RANGE' AND s."externalResourceId" = r."externalResourceId"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.snapshotId') = s."id"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.providerSnapshotId') = json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.providerSnapshotId')
      ))
     OR (r."entityType" = 'CALENDAR_EVENT' AND (
       length(r."internalEntityId") <> 28
       OR r."internalEntityId" NOT GLOB 'CAL-*'
       OR substr(r."internalEntityId", 5) GLOB '*[^0-9a-f]*'
       OR length(coalesce(json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.provenance.candidateHash'), '')) <> 64
       OR coalesce(json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.provenance.candidateHash'), '') GLOB '*[^0-9a-f]*'
       OR NOT EXISTS (
       SELECT 1 FROM "MeetingActionItem" ai JOIN "Meeting" m ON m."id" = ai."meetingId"
       WHERE ai."id" = json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.provenance.dateCandidateId')
         AND m."caseId" = r."caseId"
         AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.humanConfirmedBy') = o."actorId"
       )
     ))
) OR EXISTS (
  SELECT 1 FROM "GoogleImportSnapshot" s
  LEFT JOIN "CaseItem" c ON c."id" = s."caseId"
  LEFT JOIN "User" u ON u."id" = s."createdById"
  LEFT JOIN "GoogleSyncOperation" o ON o."id" = s."operationId"
  WHERE c."id" IS NULL OR c."organizationId" <> s."organizationId" OR c."deletedAt" IS NOT NULL
     OR u."id" IS NULL OR u."organizationId" <> s."organizationId"
     OR s."operationId" IS NULL OR o."id" IS NULL OR o."organizationId" <> s."organizationId" OR o."caseId" <> s."caseId" OR o."status" <> 'SUCCESS'
     OR s."createdById" <> o."actorId"
     OR NOT (
       (s."sourceType" = 'GMAIL_ATTACHMENT' AND o."operationKind" = 'GMAIL_IMPORT')
       OR (s."sourceType" = 'SHEETS_RANGE' AND o."operationKind" = 'SHEETS_IMPORT')
       OR (s."sourceType" = 'DOCS_TEXT' AND o."operationKind" = 'DOCS_EXPORT')
     )
     OR length(s."sha256") <> 64 OR s."sha256" GLOB '*[^0-9a-f]*'
     OR json_valid(s."provenanceJson") = 0
     OR lower(s."provenanceJson") LIKE '%ya29.%'
     OR lower(s."provenanceJson") GLOB '*access_token*'
     OR lower(s."provenanceJson") GLOB '*refresh_token*'
     OR lower(s."provenanceJson") GLOB '*client_secret*'
     OR EXISTS (
       SELECT 1 FROM json_tree(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END)
       WHERE lower(coalesce(key, '')) GLOB '*access*token*'
          OR lower(coalesce(key, '')) GLOB '*refresh*token*'
          OR lower(coalesce(key, '')) GLOB '*client*secret*'
          OR lower(coalesce(key, '')) GLOB '*authorization*code*'
          OR lower(coalesce(key, '')) GLOB '*private*key*'
          OR lower(coalesce(key, '')) GLOB '*bearer*'
     )
     OR lower(s."provenanceJson") GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
     OR lower(s."provenanceJson") GLOB '*-----begin*private*key-----*'
     OR s."sourceType" NOT IN ('GMAIL_ATTACHMENT','SHEETS_RANGE','DOCS_TEXT')
     OR s."version" < 1
      OR (s."sourceType" = 'GMAIL_ATTACHMENT' AND NOT EXISTS (
        SELECT 1 FROM "GoogleResourceLink" r
       WHERE r."organizationId" = s."organizationId"
         AND r."caseId" = s."caseId"
         AND r."operationId" = s."operationId"
         AND r."entityType" = 'GMAIL_ATTACHMENT'
         AND r."externalResourceId" = s."externalResourceId"
         AND r."internalEntityId" = json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.documentVersionId')
         AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.attachmentId') = s."externalResourceId"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.documentVersionId') = r."internalEntityId"
      ))
      OR (s."sourceType" = 'DOCS_TEXT' AND NOT EXISTS (
        SELECT 1 FROM "GoogleResourceLink" r
        JOIN "Meeting" m
          ON m."id" = json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.meetingId')
         AND m."caseId" = s."caseId"
        WHERE r."organizationId" = s."organizationId"
          AND r."caseId" = s."caseId"
          AND r."operationId" = s."operationId"
          AND r."entityType" = 'DOCS_EXPORT'
          AND r."externalResourceId" = s."externalResourceId"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.snapshotId') = s."id"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.meetingId') = m."id"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.versionNumber') = s."version"
          AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.contentSha256') = s."sha256"
          AND r."internalEntityId" = m."id" || ':v' || s."version"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.meetingVersion') = s."version"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.contentSha256') = s."sha256"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.exportedDocumentId') = s."externalResourceId"
          AND json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.exportedBy') = s."createdById"
      ))
      OR (s."sourceType" = 'SHEETS_RANGE' AND (
        json_type(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.providerSnapshotId') <> 'text'
        OR length(json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.providerSnapshotId')) < 1
        OR length(json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.providerSnapshotId')) > 200
        OR json_extract(CASE WHEN json_valid(s."provenanceJson") THEN s."provenanceJson" ELSE '{}' END, '$.providerSnapshotId') GLOB '*[^A-Za-z0-9._:-]*'
        OR NOT EXISTS (
          SELECT 1 FROM "GoogleResourceLink" r
          WHERE r."organizationId" = s."organizationId"
            AND r."caseId" = s."caseId"
            AND r."operationId" = s."operationId"
            AND r."entityType" = 'SHEETS_RANGE'
            AND r."internalEntityId" = s."id"
            AND r."externalResourceId" = s."externalResourceId"
            AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.snapshotId') = s."id"
            AND json_extract(CASE WHEN json_valid(r."resourceMetadataJson") THEN r."resourceMetadataJson" ELSE '{}' END, '$.providerSnapshotId') = json_extract(s."provenanceJson", '$.providerSnapshotId')
        )
      ))
) OR EXISTS (
  SELECT 1 FROM "GoogleSyncAttempt" GROUP BY "operationId", "attemptNumber" HAVING count(*) > 1
) OR EXISTS (
  SELECT 1 FROM "GoogleImportSnapshot"
  GROUP BY "organizationId", "caseId", "sourceType", "externalResourceId", "sha256" HAVING count(*) > 1
) OR EXISTS (
  SELECT 1 FROM "GoogleImportSnapshot"
  WHERE "sourceType" = 'GMAIL_ATTACHMENT'
  GROUP BY "organizationId", "caseId", "sourceType", "externalResourceId" HAVING count(*) > 1
) OR EXISTS (
  SELECT 1 FROM "GoogleResourceLink"
  WHERE "entityType" = 'GMAIL_ATTACHMENT'
  GROUP BY "organizationId", "caseId", "entityType", "externalResourceId" HAVING count(*) > 1
) OR EXISTS (
  SELECT 1 FROM "GoogleResourceLink"
  WHERE "entityType" IN ('CASE_DRIVE_FOLDER', 'CALENDAR_EVENT', 'DOCS_EXPORT')
  GROUP BY "organizationId", "caseId", "entityType", "internalEntityId" HAVING count(*) > 1
) OR EXISTS (
  SELECT 1 FROM "GoogleResourceLink"
  WHERE "entityType" = 'CALENDAR_EVENT'
  GROUP BY "organizationId", "caseId",
    json_extract(CASE WHEN json_valid("resourceMetadataJson") THEN "resourceMetadataJson" ELSE '{}' END, '$.provenance.dateCandidateId')
  HAVING count(*) > 1
) OR EXISTS (
  SELECT 1 FROM "GoogleSyncOperation"
  WHERE "caseId" IS NOT NULL AND "status" IN ('PENDING', 'RECONCILIATION_REQUIRED')
  GROUP BY "organizationId", "caseId", "operationKind"
  HAVING count(*) > 1
) THEN 0 ELSE 1 END;
DROP TABLE "_p14_invariant_preflight";

ALTER TABLE "GoogleOAuthState" ADD COLUMN "pkceChallenge" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GoogleOAuthState" ADD COLUMN "connectionVersion" INTEGER;
ALTER TABLE "GoogleSyncOperation" ADD COLUMN "resultJson" TEXT;
ALTER TABLE "GoogleSyncOperation" ADD COLUMN "completedAt" DATETIME;

-- Legacy Antigravity rows carried opaque references in a deprecated format. They
-- are references, not credentials, so normalize them without exposing their value.
UPDATE "GoogleWorkspaceConnection"
SET "secretRef" = 'SECREF_GOOGLE_LEGACY_' || upper(replace(substr("secretRef", 16), '-', '_'))
WHERE "secretRef" GLOB 'sec-ref-google-*';
UPDATE "GoogleOAuthState"
SET "pkceVerifierRef" = 'PKCE_LEGACY_' || upper(replace("id", '-', '_')),
    "pkceChallenge" = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    "connectionVersion" = (SELECT c."version" FROM "GoogleWorkspaceConnection" c WHERE c."organizationId" = "GoogleOAuthState"."organizationId"),
    "usedAt" = coalesce("usedAt", CAST(strftime('%s','now') AS INTEGER) * 1000);
UPDATE "GoogleSyncOperation"
SET "resultJson" = '{"migratedLegacyTerminal":true}', "completedAt" = "updatedAt"
WHERE "status" IN ('SUCCESS', 'FAILED', 'CANCELLED') AND "resultJson" IS NULL;

DROP INDEX IF EXISTS "GoogleSyncOperation_organizationId_operationKind_idempotencyKey_key";
CREATE UNIQUE INDEX "GoogleSyncOperation_scoped_idempotency_key"
ON "GoogleSyncOperation"("organizationId", "caseId", "actorId", "operationKind", "idempotencyKey");
CREATE UNIQUE INDEX "GoogleSyncAttempt_operationId_attemptNumber_key"
ON "GoogleSyncAttempt"("operationId", "attemptNumber");
CREATE UNIQUE INDEX "GoogleImportSnapshot_source_version_key"
ON "GoogleImportSnapshot"("organizationId", "caseId", "sourceType", "externalResourceId", "sha256");
CREATE UNIQUE INDEX "GoogleImportSnapshot_gmail_external_once_key"
ON "GoogleImportSnapshot"("organizationId", "caseId", "sourceType", "externalResourceId")
WHERE "sourceType" = 'GMAIL_ATTACHMENT';
CREATE UNIQUE INDEX "GoogleResourceLink_gmail_external_once_key"
ON "GoogleResourceLink"("organizationId", "caseId", "entityType", "externalResourceId")
WHERE "entityType" = 'GMAIL_ATTACHMENT';
CREATE UNIQUE INDEX "GoogleResourceLink_singleton_projection_key"
ON "GoogleResourceLink"("organizationId", "caseId", "entityType", "internalEntityId")
WHERE "entityType" IN ('CASE_DRIVE_FOLDER', 'CALENDAR_EVENT', 'DOCS_EXPORT');
CREATE UNIQUE INDEX "GoogleResourceLink_calendar_candidate_once_key"
ON "GoogleResourceLink"(
  "organizationId",
  "caseId",
  json_extract("resourceMetadataJson", '$.provenance.dateCandidateId')
)
WHERE "entityType" = 'CALENDAR_EVENT';
CREATE UNIQUE INDEX "GoogleSyncOperation_one_unresolved_kind_per_case_key"
ON "GoogleSyncOperation"("organizationId", "caseId", "operationKind")
WHERE "caseId" IS NOT NULL AND "status" IN ('PENDING', 'RECONCILIATION_REQUIRED');

CREATE TRIGGER "p14_connection_insert_guard"
BEFORE INSERT ON "GoogleWorkspaceConnection"
BEGIN
  SELECT CASE WHEN NEW."status" NOT IN ('CONNECTED', 'EXPIRED', 'RECONSENT_REQUIRED', 'DISCONNECTED')
    THEN RAISE(ABORT, 'P14: invalid Google connection status') END;
  SELECT CASE WHEN json_valid(NEW."grantedScopesJson") = 0 OR json_type(NEW."grantedScopesJson") <> 'array'
      OR lower(NEW."grantedScopesJson") LIKE '%ya29.%'
      OR lower(NEW."grantedScopesJson") GLOB '*access_token*'
      OR lower(NEW."grantedScopesJson") GLOB '*refresh_token*'
      OR lower(NEW."grantedScopesJson") GLOB '*client_secret*'
    THEN RAISE(ABORT, 'P14: invalid or sensitive Google scope metadata') END;
  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM json_each(NEW."grantedScopesJson") granted
      WHERE granted.value NOT IN (
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      )
    ) THEN RAISE(ABORT, 'P14: Google scope exceeds the approved least-privilege allowlist') END;
  SELECT CASE WHEN NEW."status" = 'CONNECTED' AND (
      NEW."tokenExpiresAt" IS NULL
      OR (SELECT count(*) FROM json_each(NEW."grantedScopesJson")) <> 5
      OR (SELECT count(DISTINCT value) FROM json_each(NEW."grantedScopesJson")) <> 5
      OR EXISTS (
        SELECT 1 FROM (
          SELECT 'https://www.googleapis.com/auth/drive.file' AS scope
          UNION ALL SELECT 'https://www.googleapis.com/auth/gmail.readonly'
          UNION ALL SELECT 'https://www.googleapis.com/auth/calendar.events'
          UNION ALL SELECT 'https://www.googleapis.com/auth/documents'
          UNION ALL SELECT 'https://www.googleapis.com/auth/spreadsheets.readonly'
        ) required
        WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW."grantedScopesJson") granted WHERE granted.value = required.scope)
      )
    ) THEN RAISE(ABORT, 'P14: connected Google row requires expiry and all scopes') END;
  SELECT CASE WHEN NOT (
      NEW."secretRef" = 'LOCAL_FAKE_GOOGLE'
      OR (NEW."secretRef" GLOB 'ENV_*' AND length(NEW."secretRef") > 4 AND NEW."secretRef" NOT GLOB '*[^A-Z0-9_]*')
      OR (NEW."secretRef" GLOB 'SECREF_*' AND length(NEW."secretRef") > 7 AND NEW."secretRef" NOT GLOB '*[^A-Z0-9_-]*')
    ) OR lower(NEW."secretRef") LIKE '%ya29.%'
      OR lower(NEW."secretRef") GLOB '*access_token*'
      OR lower(NEW."secretRef") GLOB '*refresh_token*'
      OR lower(NEW."secretRef") GLOB '*client_secret*'
      OR lower(NEW."secretRef") LIKE '%bearer %'
    THEN RAISE(ABORT, 'P14: raw Google credential cannot be stored') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = NEW."createdById" AND u."organizationId" = NEW."organizationId" AND u."isActive" = 1
    ) THEN RAISE(ABORT, 'P14: connection actor organization mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "UserRole" ur WHERE ur."userId" = NEW."createdById" AND ur."roleId" = 'admin'
    ) THEN RAISE(ABORT, 'P14: Google connection requires an Admin actor') END;
END;

CREATE TRIGGER "p14_connection_update_guard"
BEFORE UPDATE ON "GoogleWorkspaceConnection"
BEGIN
  SELECT CASE WHEN NEW."organizationId" <> OLD."organizationId" OR NEW."createdById" <> OLD."createdById"
    THEN RAISE(ABORT, 'P14: connection scope is immutable') END;
  SELECT CASE WHEN NEW."version" <> OLD."version" + 1
    THEN RAISE(ABORT, 'P14: connection version must increment by one') END;
  SELECT CASE WHEN NEW."status" NOT IN ('CONNECTED', 'EXPIRED', 'RECONSENT_REQUIRED', 'DISCONNECTED')
    THEN RAISE(ABORT, 'P14: invalid Google connection status') END;
  SELECT CASE WHEN json_valid(NEW."grantedScopesJson") = 0 OR json_type(NEW."grantedScopesJson") <> 'array'
      OR lower(NEW."grantedScopesJson") LIKE '%ya29.%'
      OR lower(NEW."grantedScopesJson") GLOB '*access_token*'
      OR lower(NEW."grantedScopesJson") GLOB '*refresh_token*'
      OR lower(NEW."grantedScopesJson") GLOB '*client_secret*'
    THEN RAISE(ABORT, 'P14: invalid or sensitive Google scope metadata') END;
  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM json_each(NEW."grantedScopesJson") granted
      WHERE granted.value NOT IN (
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets.readonly'
      )
    ) THEN RAISE(ABORT, 'P14: Google scope exceeds the approved least-privilege allowlist') END;
  SELECT CASE WHEN NEW."status" = 'CONNECTED' AND (
      NEW."tokenExpiresAt" IS NULL
      OR (SELECT count(*) FROM json_each(NEW."grantedScopesJson")) <> 5
      OR (SELECT count(DISTINCT value) FROM json_each(NEW."grantedScopesJson")) <> 5
      OR EXISTS (
        SELECT 1 FROM (
          SELECT 'https://www.googleapis.com/auth/drive.file' AS scope
          UNION ALL SELECT 'https://www.googleapis.com/auth/gmail.readonly'
          UNION ALL SELECT 'https://www.googleapis.com/auth/calendar.events'
          UNION ALL SELECT 'https://www.googleapis.com/auth/documents'
          UNION ALL SELECT 'https://www.googleapis.com/auth/spreadsheets.readonly'
        ) required
        WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW."grantedScopesJson") granted WHERE granted.value = required.scope)
      )
    ) THEN RAISE(ABORT, 'P14: connected Google row requires expiry and all scopes') END;
  SELECT CASE WHEN NOT (
      NEW."secretRef" = 'LOCAL_FAKE_GOOGLE'
      OR (NEW."secretRef" GLOB 'ENV_*' AND length(NEW."secretRef") > 4 AND NEW."secretRef" NOT GLOB '*[^A-Z0-9_]*')
      OR (NEW."secretRef" GLOB 'SECREF_*' AND length(NEW."secretRef") > 7 AND NEW."secretRef" NOT GLOB '*[^A-Z0-9_-]*')
    ) OR lower(NEW."secretRef") LIKE '%ya29.%'
      OR lower(NEW."secretRef") GLOB '*access_token*'
      OR lower(NEW."secretRef") GLOB '*refresh_token*'
      OR lower(NEW."secretRef") GLOB '*client_secret*'
      OR lower(NEW."secretRef") LIKE '%bearer %'
    THEN RAISE(ABORT, 'P14: raw Google credential cannot be stored') END;
END;

CREATE TRIGGER "p14_connection_delete_guard"
BEFORE DELETE ON "GoogleWorkspaceConnection"
BEGIN
  SELECT RAISE(ABORT, 'P14: Google connection history cannot be deleted; use audited disconnect');
END;

CREATE TRIGGER "p14_oauth_state_insert_guard"
BEFORE INSERT ON "GoogleOAuthState"
BEGIN
  SELECT CASE WHEN length(NEW."stateHash") <> 64 OR NEW."stateHash" GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'P14: OAuth state must be stored as SHA-256 only') END;
  SELECT CASE WHEN length(NEW."pkceChallenge") <> 43
      OR NEW."pkceChallenge" GLOB '*[^A-Za-z0-9_-]*'
    THEN RAISE(ABORT, 'P14: invalid PKCE S256 challenge') END;
  SELECT CASE WHEN NEW."pkceVerifierRef" NOT GLOB 'PKCE_*'
      OR length(NEW."pkceVerifierRef") <= 5
      OR NEW."pkceVerifierRef" GLOB '*[^A-Z0-9_-]*'
    THEN RAISE(ABORT, 'P14: PKCE verifier must be a server reference') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = NEW."actorId" AND u."organizationId" = NEW."organizationId" AND u."isActive" = 1
    ) THEN RAISE(ABORT, 'P14: OAuth actor organization mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "UserRole" ur WHERE ur."userId" = NEW."actorId" AND ur."roleId" = 'admin'
    ) THEN RAISE(ABORT, 'P14: Google OAuth state requires an Admin actor') END;
  SELECT CASE WHEN NEW."redirectTarget" <> '/integrations/google'
    THEN RAISE(ABORT, 'P14: OAuth redirect must be an approved internal path') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM "GoogleWorkspaceConnection" c WHERE c."organizationId" = NEW."organizationId")
      AND coalesce(NEW."connectionVersion", -1) <> (SELECT c."version" FROM "GoogleWorkspaceConnection" c WHERE c."organizationId" = NEW."organizationId")
    THEN RAISE(ABORT, 'P14: OAuth connection version snapshot mismatch') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "GoogleWorkspaceConnection" c WHERE c."organizationId" = NEW."organizationId")
      AND NEW."connectionVersion" IS NOT NULL
    THEN RAISE(ABORT, 'P14: unexpected OAuth connection version snapshot') END;
END;

CREATE TRIGGER "p14_oauth_state_update_guard"
BEFORE UPDATE ON "GoogleOAuthState"
BEGIN
  SELECT CASE WHEN OLD."usedAt" IS NOT NULL
    THEN RAISE(ABORT, 'P14: consumed OAuth state is immutable') END;
  SELECT CASE WHEN NEW."stateHash" <> OLD."stateHash"
      OR NEW."id" <> OLD."id"
      OR NEW."pkceVerifierRef" <> OLD."pkceVerifierRef"
      OR NEW."pkceChallenge" <> OLD."pkceChallenge"
      OR coalesce(NEW."connectionVersion", -1) <> coalesce(OLD."connectionVersion", -1)
      OR NEW."organizationId" <> OLD."organizationId"
      OR NEW."actorId" <> OLD."actorId"
      OR NEW."redirectTarget" <> OLD."redirectTarget"
      OR NEW."expiresAt" <> OLD."expiresAt"
      OR NEW."createdAt" <> OLD."createdAt"
    THEN RAISE(ABORT, 'P14: OAuth state binding is immutable') END;
  SELECT CASE WHEN NEW."usedAt" IS NULL
    THEN RAISE(ABORT, 'P14: OAuth state update must consume the state') END;
END;

CREATE TRIGGER "p14_oauth_state_delete_guard"
BEFORE DELETE ON "GoogleOAuthState"
BEGIN
  SELECT RAISE(ABORT, 'P14: OAuth state history is immutable');
END;

CREATE TRIGGER "p14_sync_operation_insert_guard"
BEFORE INSERT ON "GoogleSyncOperation"
BEGIN
  SELECT CASE WHEN NEW."status" <> 'PENDING' OR NEW."resultJson" IS NOT NULL OR NEW."completedAt" IS NOT NULL
    THEN RAISE(ABORT, 'P14: Google operation must start PENDING') END;
  SELECT CASE WHEN NEW."operationKind" NOT IN ('CONNECTION_TEST','DRIVE_FOLDER','GMAIL_IMPORT','CALENDAR_EVENT','DOCS_EXPORT','SHEETS_IMPORT')
    THEN RAISE(ABORT, 'P14: invalid Google operation kind') END;
  SELECT CASE WHEN (NEW."operationKind" = 'CONNECTION_TEST' AND NEW."caseId" IS NOT NULL)
      OR (NEW."operationKind" <> 'CONNECTION_TEST' AND NEW."caseId" IS NULL)
    THEN RAISE(ABORT, 'P14: Google operation case scope does not match its kind') END;
  SELECT CASE WHEN NEW."caseId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "CaseItem" c
      WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."deletedAt" IS NULL
    ) THEN RAISE(ABORT, 'P14: Google operation case organization mismatch') END;
  SELECT CASE WHEN NEW."caseId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "CaseAssignment" a WHERE a."caseId" = NEW."caseId" AND a."userId" = NEW."actorId"
    ) THEN RAISE(ABORT, 'P14: Google operation actor assignment mismatch') END;
  SELECT CASE WHEN NEW."caseId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "UserRole" ur WHERE ur."userId" = NEW."actorId" AND ur."roleId" IN ('ceo', 'director', 'pm', 'staff', 'reviewer', 'admin')
    ) THEN RAISE(ABORT, 'P14: Google operation actor role mismatch') END;
  SELECT CASE WHEN NEW."caseId" IS NOT NULL AND NEW."operationKind" = 'CALENDAR_EVENT' AND NOT EXISTS (
      SELECT 1 FROM "UserRole" ur WHERE ur."userId" = NEW."actorId" AND ur."roleId" IN ('ceo', 'director', 'pm', 'admin')
    ) THEN RAISE(ABORT, 'P14: Google Calendar operation requires an editor role') END;
  SELECT CASE WHEN NEW."operationKind" = 'CONNECTION_TEST' AND NOT EXISTS (
      SELECT 1 FROM "UserRole" ur WHERE ur."userId" = NEW."actorId" AND ur."roleId" = 'admin'
    ) THEN RAISE(ABORT, 'P14: Google connection test requires an Admin actor') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = NEW."actorId" AND u."organizationId" = NEW."organizationId" AND u."isActive" = 1
    ) THEN RAISE(ABORT, 'P14: Google operation actor organization mismatch') END;
  SELECT CASE WHEN length(NEW."requestFingerprint") <> 64 OR NEW."requestFingerprint" GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'P14: Google operation fingerprint must be SHA-256') END;
  SELECT CASE WHEN NEW."caseId" IS NOT NULL AND (
      NEW."idempotencyKey" IS NULL OR length(NEW."idempotencyKey") < 8 OR length(NEW."idempotencyKey") > 120
      OR NEW."idempotencyKey" GLOB '*[^A-Za-z0-9._:-]*'
    ) THEN RAISE(ABORT, 'P14: invalid case-scoped idempotency key') END;
END;

CREATE TRIGGER "p14_sync_operation_update_guard"
BEFORE UPDATE ON "GoogleSyncOperation"
BEGIN
  SELECT CASE WHEN OLD."status" NOT IN ('PENDING', 'RECONCILIATION_REQUIRED')
    THEN RAISE(ABORT, 'P14: terminal Google operation is immutable') END;
  SELECT CASE WHEN NEW."organizationId" <> OLD."organizationId"
      OR coalesce(NEW."caseId", '') <> coalesce(OLD."caseId", '')
      OR NEW."actorId" <> OLD."actorId"
      OR NEW."operationKind" <> OLD."operationKind"
      OR coalesce(NEW."idempotencyKey", '') <> coalesce(OLD."idempotencyKey", '')
      OR NEW."requestFingerprint" <> OLD."requestFingerprint"
      OR NEW."createdAt" <> OLD."createdAt"
    THEN RAISE(ABORT, 'P14: Google operation identity is immutable') END;
  SELECT CASE WHEN NEW."status" NOT IN ('SUCCESS', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED', 'RECONCILED_NO_SIDE_EFFECT')
      OR NEW."resultJson" IS NULL OR NEW."completedAt" IS NULL
    THEN RAISE(ABORT, 'P14: invalid terminal Google operation transition') END;
  SELECT CASE WHEN OLD."status" = 'RECONCILIATION_REQUIRED' AND NEW."status" <> 'RECONCILED_NO_SIDE_EFFECT'
    THEN RAISE(ABORT, 'P14: reconciliation-required operation only permits an audited no-side-effect resolution') END;
  SELECT CASE WHEN NEW."status" = 'RECONCILED_NO_SIDE_EFFECT' AND OLD."status" = 'PENDING'
      AND OLD."updatedAt" > (CAST(strftime('%s','now') AS INTEGER) - 300) * 1000
    THEN RAISE(ABORT, 'P14: pending Google operation is not old enough for manual reconciliation') END;
  SELECT CASE WHEN NEW."status" = 'RECONCILED_NO_SIDE_EFFECT' AND (
      json_valid(NEW."resultJson") = 0
      OR json_extract(NEW."resultJson", '$.httpStatus') <> 409
      OR json_extract(NEW."resultJson", '$.body.status') <> 'RECONCILED_NO_SIDE_EFFECT'
      OR json_extract(NEW."resultJson", '$.body.resolution') <> 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT'
      OR json_extract(NEW."resultJson", '$.body.confirmation') <> 'NO_EXTERNAL_RESOURCE_CONFIRMED'
      OR length(coalesce(json_extract(NEW."resultJson", '$.body.resolvedById'), '')) = 0
      OR length(coalesce(json_extract(NEW."resultJson", '$.body.verificationReferenceHash'), '')) <> 64
      OR json_extract(NEW."resultJson", '$.body.verificationReferenceHash') GLOB '*[^0-9a-f]*'
      OR NOT EXISTS (
        SELECT 1
        FROM "AuditLog" a
        JOIN "User" u ON u."id" = a."userId"
        JOIN "UserRole" ur ON ur."userId" = u."id" AND ur."roleId" = 'admin'
        WHERE a."organizationId" = OLD."organizationId"
          AND a."action" = 'GOOGLE_RECONCILIATION_RESOLVED'
          AND a."targetEntity" = 'GoogleSyncOperation'
          AND a."targetId" = OLD."id"
          AND a."userId" = json_extract(NEW."resultJson", '$.body.resolvedById')
          AND u."organizationId" = OLD."organizationId"
          AND u."isActive" = 1
          AND json_valid(a."metadataJson") = 1
          AND json_extract(a."metadataJson", '$.resolution') = 'CONFIRMED_NO_EXTERNAL_SIDE_EFFECT'
          AND json_extract(a."metadataJson", '$.confirmation') = 'NO_EXTERNAL_RESOURCE_CONFIRMED'
          AND json_extract(a."metadataJson", '$.verificationReferenceHash') = json_extract(NEW."resultJson", '$.body.verificationReferenceHash')
      )
    ) THEN RAISE(ABORT, 'P14: reconciliation resolution requires a same-transaction active Admin audit') END;
  SELECT CASE WHEN NEW."status" <> 'SUCCESS' AND (
      EXISTS (SELECT 1 FROM "GoogleResourceLink" r WHERE r."operationId" = NEW."id")
      OR EXISTS (SELECT 1 FROM "GoogleImportSnapshot" s WHERE s."operationId" = NEW."id")
    ) THEN RAISE(ABORT, 'P14: projected Google operation can only terminalize as SUCCESS') END;
  SELECT CASE WHEN NEW."status" = 'SUCCESS' AND OLD."operationKind" = 'GMAIL_IMPORT' AND (
      NOT EXISTS (
        SELECT 1 FROM "GoogleImportSnapshot" s
        WHERE s."operationId" = NEW."id" AND s."sourceType" = 'GMAIL_ATTACHMENT'
      )
      OR NOT EXISTS (
        SELECT 1 FROM "GoogleResourceLink" r
        WHERE r."operationId" = NEW."id" AND r."entityType" = 'GMAIL_ATTACHMENT'
      )
      OR EXISTS (
        SELECT 1 FROM "GoogleImportSnapshot" s
        WHERE s."operationId" = NEW."id" AND s."sourceType" = 'GMAIL_ATTACHMENT'
          AND NOT EXISTS (
            SELECT 1 FROM "GoogleResourceLink" r
            WHERE r."organizationId" = s."organizationId"
              AND r."caseId" = s."caseId"
              AND r."operationId" = s."operationId"
              AND r."entityType" = 'GMAIL_ATTACHMENT'
              AND r."externalResourceId" = s."externalResourceId"
              AND r."internalEntityId" = json_extract(s."provenanceJson", '$.documentVersionId')
              AND json_extract(s."provenanceJson", '$.attachmentId') = s."externalResourceId"
              AND json_extract(r."resourceMetadataJson", '$.documentVersionId') = r."internalEntityId"
          )
      )
      OR EXISTS (
        SELECT 1 FROM "GoogleResourceLink" r
        WHERE r."operationId" = NEW."id" AND r."entityType" = 'GMAIL_ATTACHMENT'
          AND NOT EXISTS (
            SELECT 1 FROM "GoogleImportSnapshot" s
            WHERE s."organizationId" = r."organizationId"
              AND s."caseId" = r."caseId"
              AND s."operationId" = r."operationId"
              AND s."sourceType" = 'GMAIL_ATTACHMENT'
              AND s."externalResourceId" = r."externalResourceId"
              AND json_extract(s."provenanceJson", '$.documentVersionId') = r."internalEntityId"
              AND json_extract(s."provenanceJson", '$.attachmentId') = r."externalResourceId"
              AND json_extract(r."resourceMetadataJson", '$.documentVersionId') = r."internalEntityId"
          )
      )
    ) THEN RAISE(ABORT, 'P14: Gmail success requires a complete one-to-one snapshot/resource projection') END;
  SELECT CASE WHEN NEW."status" = 'SUCCESS' AND OLD."operationKind" = 'DOCS_EXPORT' AND (
      (SELECT count(*) FROM "GoogleImportSnapshot" s WHERE s."operationId" = NEW."id" AND s."sourceType" = 'DOCS_TEXT') <> 1
      OR (SELECT count(*) FROM "GoogleResourceLink" r WHERE r."operationId" = NEW."id" AND r."entityType" = 'DOCS_EXPORT') <> 1
      OR NOT EXISTS (
        SELECT 1 FROM "GoogleImportSnapshot" s
        JOIN "GoogleResourceLink" r
          ON r."organizationId" = s."organizationId"
         AND r."caseId" = s."caseId"
         AND r."operationId" = s."operationId"
         AND r."entityType" = 'DOCS_EXPORT'
         AND r."externalResourceId" = s."externalResourceId"
         AND json_extract(r."resourceMetadataJson", '$.snapshotId') = s."id"
        JOIN "Meeting" m
          ON m."id" = json_extract(s."provenanceJson", '$.meetingId')
         AND m."caseId" = s."caseId"
        WHERE s."operationId" = NEW."id"
          AND s."sourceType" = 'DOCS_TEXT'
          AND s."createdById" = NEW."actorId"
          AND s."version" = json_extract(r."resourceMetadataJson", '$.versionNumber')
          AND s."sha256" = json_extract(r."resourceMetadataJson", '$.contentSha256')
          AND json_extract(s."provenanceJson", '$.meetingVersion') = s."version"
          AND json_extract(s."provenanceJson", '$.contentSha256') = s."sha256"
          AND json_extract(s."provenanceJson", '$.exportedDocumentId') = s."externalResourceId"
          AND json_extract(s."provenanceJson", '$.exportedBy') = s."createdById"
          AND r."internalEntityId" = m."id" || ':v' || s."version"
      )
    ) THEN RAISE(ABORT, 'P14: Docs success requires one bound source snapshot and resource projection') END;
  SELECT CASE WHEN json_valid(NEW."resultJson") = 0
    THEN RAISE(ABORT, 'P14: Google operation result must be JSON') END;
  SELECT CASE WHEN lower(NEW."resultJson") LIKE '%ya29.%'
      OR lower(NEW."resultJson") GLOB '*access_token*'
      OR lower(NEW."resultJson") GLOB '*refresh_token*'
      OR lower(NEW."resultJson") GLOB '*authorization_code*'
      OR lower(NEW."resultJson") GLOB '*client_secret*'
      OR EXISTS (
        SELECT 1 FROM json_tree(NEW."resultJson")
        WHERE lower(coalesce(key, '')) GLOB '*access*token*'
           OR lower(coalesce(key, '')) GLOB '*refresh*token*'
           OR lower(coalesce(key, '')) GLOB '*client*secret*'
           OR lower(coalesce(key, '')) GLOB '*authorization*code*'
           OR lower(coalesce(key, '')) GLOB '*private*key*'
           OR lower(coalesce(key, '')) GLOB '*bearer*'
      )
      OR lower(NEW."resultJson") GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
      OR lower(NEW."resultJson") GLOB '*-----begin*private*key-----*'
    THEN RAISE(ABORT, 'P14: credential-like data cannot be stored in operation result') END;
END;

CREATE TRIGGER "p14_sync_operation_delete_guard"
BEFORE DELETE ON "GoogleSyncOperation"
WHEN OLD."status" <> 'PENDING'
BEGIN
  SELECT RAISE(ABORT, 'P14: terminal Google operation is immutable');
END;

CREATE TRIGGER "p14_sync_attempt_insert_guard"
BEFORE INSERT ON "GoogleSyncAttempt"
BEGIN
  SELECT CASE WHEN NEW."attemptNumber" < 1 OR NEW."attemptNumber" > 3
    THEN RAISE(ABORT, 'P14: Google retry attempt out of bounds') END;
  SELECT CASE WHEN NEW."durationMs" < 0 OR NEW."durationMs" > 2147483647
      OR NEW."responseClass" NOT IN ('SUCCESS','DUPLICATE_REPLAY','BAD_SCOPE','TOKEN_EXPIRED','RECONSENT_REQUIRED','RATE_LIMIT_RETRY_AFTER','SERVER_ERROR','TIMEOUT','USER_CANCEL','MALFORMED_PROVIDER_RESPONSE','REVOKE_FAILURE')
    THEN RAISE(ABORT, 'P14: invalid Google attempt response') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "GoogleSyncOperation" o WHERE o."id" = NEW."operationId" AND o."status" = 'PENDING'
    ) THEN RAISE(ABORT, 'P14: attempts can only be appended to a pending operation') END;
  SELECT CASE WHEN lower(coalesce(NEW."redactedError", '')) LIKE '%ya29.%'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*access_token*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*refresh_token*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*client_secret*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*accesstoken[=:]*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*refresh-token[=:]*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*client secret[=:]*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*authorization_code[=:]*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*privatekey[=:]*'
      OR lower(coalesce(NEW."redactedError", '')) GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
      OR EXISTS (
        SELECT 1 FROM json_tree(CASE WHEN json_valid(coalesce(NEW."redactedError", '')) THEN NEW."redactedError" ELSE '{}' END)
        WHERE lower(coalesce(key, '')) GLOB '*access*token*'
           OR lower(coalesce(key, '')) GLOB '*refresh*token*'
           OR lower(coalesce(key, '')) GLOB '*client*secret*'
           OR lower(coalesce(key, '')) GLOB '*authorization*code*'
           OR lower(coalesce(key, '')) GLOB '*private*key*'
           OR lower(coalesce(key, '')) GLOB '*bearer*'
      )
    THEN RAISE(ABORT, 'P14: raw credential in Google attempt error') END;
END;

CREATE TRIGGER "p14_resource_link_scope_guard"
BEFORE INSERT ON "GoogleResourceLink"
BEGIN
  SELECT CASE WHEN NEW."entityType" NOT IN ('CASE_DRIVE_FOLDER','CALENDAR_EVENT','DOCS_EXPORT','GMAIL_ATTACHMENT','SHEETS_RANGE')
      OR length(NEW."internalEntityId") = 0 OR length(NEW."externalResourceId") = 0
    THEN RAISE(ABORT, 'P14: invalid Google resource identity') END;
  SELECT CASE WHEN json_valid(NEW."resourceMetadataJson") = 0
    THEN RAISE(ABORT, 'P14: Google resource metadata must be JSON') END;
  SELECT CASE WHEN NEW."caseId" IS NULL OR NEW."operationId" IS NULL
    THEN RAISE(ABORT, 'P14: Google resource requires an audited case operation') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "CaseItem" c
      WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."deletedAt" IS NULL
    ) THEN RAISE(ABORT, 'P14: Google resource case organization mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "GoogleSyncOperation" o
      WHERE o."id" = NEW."operationId" AND o."organizationId" = NEW."organizationId"
        AND coalesce(o."caseId", '') = coalesce(NEW."caseId", '') AND o."status" = 'PENDING'
        AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = o."actorId" AND u."organizationId" = o."organizationId" AND u."isActive" = 1)
        AND EXISTS (SELECT 1 FROM "CaseAssignment" a WHERE a."caseId" = o."caseId" AND a."userId" = o."actorId")
        AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = o."actorId" AND ur."roleId" IN ('ceo','director','pm','staff','reviewer','admin'))
        AND (o."operationKind" <> 'CALENDAR_EVENT' OR EXISTS (
          SELECT 1 FROM "UserRole" ur WHERE ur."userId" = o."actorId" AND ur."roleId" IN ('ceo','director','pm','admin')
        ))
        AND (
          (NEW."entityType" = 'CASE_DRIVE_FOLDER' AND o."operationKind" = 'DRIVE_FOLDER')
          OR (NEW."entityType" = 'CALENDAR_EVENT' AND o."operationKind" = 'CALENDAR_EVENT')
          OR (NEW."entityType" = 'DOCS_EXPORT' AND o."operationKind" = 'DOCS_EXPORT')
          OR (NEW."entityType" = 'GMAIL_ATTACHMENT' AND o."operationKind" = 'GMAIL_IMPORT')
          OR (NEW."entityType" = 'SHEETS_RANGE' AND o."operationKind" = 'SHEETS_IMPORT')
        )
    ) THEN RAISE(ABORT, 'P14: Google resource operation scope mismatch') END;
  SELECT CASE WHEN lower(NEW."resourceMetadataJson") LIKE '%ya29.%'
      OR lower(NEW."resourceMetadataJson") GLOB '*access_token*'
      OR lower(NEW."resourceMetadataJson") GLOB '*refresh_token*'
      OR lower(NEW."resourceMetadataJson") GLOB '*client_secret*'
      OR EXISTS (
        SELECT 1 FROM json_tree(NEW."resourceMetadataJson")
        WHERE lower(coalesce(key, '')) GLOB '*access*token*'
           OR lower(coalesce(key, '')) GLOB '*refresh*token*'
           OR lower(coalesce(key, '')) GLOB '*client*secret*'
           OR lower(coalesce(key, '')) GLOB '*authorization*code*'
           OR lower(coalesce(key, '')) GLOB '*private*key*'
           OR lower(coalesce(key, '')) GLOB '*bearer*'
      )
      OR lower(NEW."resourceMetadataJson") GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
      OR lower(NEW."resourceMetadataJson") GLOB '*-----begin*private*key-----*'
    THEN RAISE(ABORT, 'P14: credential-like data cannot be stored in resource metadata') END;
  SELECT CASE WHEN NEW."entityType" = 'CASE_DRIVE_FOLDER' AND NEW."internalEntityId" <> NEW."caseId"
    THEN RAISE(ABORT, 'P14: Drive folder resource must be bound to its case') END;
  SELECT CASE WHEN NEW."entityType" = 'GMAIL_ATTACHMENT' AND NOT EXISTS (
      SELECT 1 FROM "DocumentVersion" dv
      JOIN "Document" d ON d."id" = dv."documentId"
      JOIN "GoogleImportSnapshot" s
        ON s."organizationId" = NEW."organizationId"
       AND s."caseId" = NEW."caseId"
       AND s."operationId" = NEW."operationId"
       AND s."sourceType" = 'GMAIL_ATTACHMENT'
       AND s."externalResourceId" = NEW."externalResourceId"
      WHERE dv."id" = NEW."internalEntityId"
        AND d."caseId" = NEW."caseId"
        AND d."deletedAt" IS NULL
        AND json_extract(NEW."resourceMetadataJson", '$.documentVersionId') = NEW."internalEntityId"
        AND json_extract(s."provenanceJson", '$.documentVersionId') = NEW."internalEntityId"
        AND json_extract(s."provenanceJson", '$.attachmentId') = NEW."externalResourceId"
    ) THEN RAISE(ABORT, 'P14: Gmail resource document belongs to another case or is missing') END;
  SELECT CASE WHEN NEW."entityType" = 'DOCS_EXPORT' AND NOT EXISTS (
      SELECT 1 FROM "Meeting" m
      JOIN "GoogleImportSnapshot" s
        ON s."id" = json_extract(NEW."resourceMetadataJson", '$.snapshotId')
      WHERE m."id" = json_extract(NEW."resourceMetadataJson", '$.meetingId') AND m."caseId" = NEW."caseId"
        AND m."version" = json_extract(NEW."resourceMetadataJson", '$.versionNumber')
        AND NEW."internalEntityId" = m."id" || ':v' || m."version"
        AND s."organizationId" = NEW."organizationId"
        AND s."caseId" = NEW."caseId"
        AND s."operationId" = NEW."operationId"
        AND s."sourceType" = 'DOCS_TEXT'
        AND s."externalResourceId" = NEW."externalResourceId"
        AND s."sha256" = json_extract(NEW."resourceMetadataJson", '$.contentSha256')
        AND s."version" = m."version"
        AND json_extract(s."provenanceJson", '$.meetingId') = m."id"
        AND json_extract(s."provenanceJson", '$.meetingVersion') = s."version"
        AND json_extract(s."provenanceJson", '$.contentSha256') = s."sha256"
        AND json_extract(s."provenanceJson", '$.exportedDocumentId') = s."externalResourceId"
    ) THEN RAISE(ABORT, 'P14: Docs export is not bound to the selected case meeting version') END;
  SELECT CASE WHEN NEW."entityType" = 'SHEETS_RANGE' AND NOT EXISTS (
      SELECT 1 FROM "GoogleImportSnapshot" s
      WHERE s."id" = NEW."internalEntityId" AND s."caseId" = NEW."caseId"
        AND s."organizationId" = NEW."organizationId" AND s."operationId" = NEW."operationId"
        AND s."sourceType" = 'SHEETS_RANGE' AND s."externalResourceId" = NEW."externalResourceId"
        AND json_extract(NEW."resourceMetadataJson", '$.snapshotId') = s."id"
        AND json_extract(NEW."resourceMetadataJson", '$.providerSnapshotId') = json_extract(s."provenanceJson", '$.providerSnapshotId')
    ) THEN RAISE(ABORT, 'P14: Sheets resource is not bound to its audited snapshot') END;
  SELECT CASE WHEN NEW."entityType" = 'CALENDAR_EVENT' AND (
      length(NEW."internalEntityId") <> 28
      OR NEW."internalEntityId" NOT GLOB 'CAL-*'
      OR substr(NEW."internalEntityId", 5) GLOB '*[^0-9a-f]*'
      OR length(coalesce(json_extract(NEW."resourceMetadataJson", '$.provenance.candidateHash'), '')) <> 64
      OR coalesce(json_extract(NEW."resourceMetadataJson", '$.provenance.candidateHash'), '') GLOB '*[^0-9a-f]*'
      OR NOT EXISTS (
        SELECT 1 FROM "MeetingActionItem" ai JOIN "Meeting" m ON m."id" = ai."meetingId"
        JOIN "GoogleSyncOperation" o ON o."id" = NEW."operationId"
        WHERE ai."id" = json_extract(NEW."resourceMetadataJson", '$.provenance.dateCandidateId')
          AND m."caseId" = NEW."caseId"
          AND json_extract(NEW."resourceMetadataJson", '$.humanConfirmedBy') = o."actorId"
      )
    ) THEN RAISE(ABORT, 'P14: Calendar resource is not bound to its confirmed case source') END;
END;

CREATE TRIGGER "p14_import_snapshot_scope_guard"
BEFORE INSERT ON "GoogleImportSnapshot"
BEGIN
  SELECT CASE WHEN NEW."sourceType" NOT IN ('GMAIL_ATTACHMENT','SHEETS_RANGE','DOCS_TEXT') OR NEW."version" < 1
    THEN RAISE(ABORT, 'P14: invalid Google snapshot source') END;
  SELECT CASE WHEN json_valid(NEW."provenanceJson") = 0
    THEN RAISE(ABORT, 'P14: Google snapshot provenance must be JSON') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "CaseItem" c
      WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."deletedAt" IS NULL
    ) THEN RAISE(ABORT, 'P14: Google snapshot case organization mismatch') END;
  SELECT CASE WHEN NEW."operationId" IS NULL
    THEN RAISE(ABORT, 'P14: Google snapshot requires an audited case operation') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "GoogleSyncOperation" o
      WHERE o."id" = NEW."operationId" AND o."organizationId" = NEW."organizationId"
        AND o."caseId" = NEW."caseId" AND o."status" = 'PENDING' AND o."actorId" = NEW."createdById"
        AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = o."actorId" AND u."organizationId" = o."organizationId" AND u."isActive" = 1)
        AND EXISTS (SELECT 1 FROM "CaseAssignment" a WHERE a."caseId" = o."caseId" AND a."userId" = o."actorId")
        AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = o."actorId" AND ur."roleId" IN ('ceo','director','pm','staff','reviewer','admin'))
        AND (
          (NEW."sourceType" = 'GMAIL_ATTACHMENT' AND o."operationKind" = 'GMAIL_IMPORT')
          OR (NEW."sourceType" = 'SHEETS_RANGE' AND o."operationKind" = 'SHEETS_IMPORT')
          OR (NEW."sourceType" = 'DOCS_TEXT' AND o."operationKind" = 'DOCS_EXPORT')
        )
    ) THEN RAISE(ABORT, 'P14: Google snapshot operation scope mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM "User" u
      WHERE u."id" = NEW."createdById" AND u."organizationId" = NEW."organizationId" AND u."isActive" = 1
    ) THEN RAISE(ABORT, 'P14: Google snapshot actor organization mismatch') END;
  SELECT CASE WHEN length(NEW."sha256") <> 64 OR NEW."sha256" GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'P14: snapshot SHA-256 is invalid') END;
  SELECT CASE WHEN lower(NEW."provenanceJson") LIKE '%ya29.%'
      OR lower(NEW."provenanceJson") GLOB '*access_token*'
      OR lower(NEW."provenanceJson") GLOB '*refresh_token*'
      OR lower(NEW."provenanceJson") GLOB '*client_secret*'
      OR EXISTS (
        SELECT 1 FROM json_tree(NEW."provenanceJson")
        WHERE lower(coalesce(key, '')) GLOB '*access*token*'
           OR lower(coalesce(key, '')) GLOB '*refresh*token*'
           OR lower(coalesce(key, '')) GLOB '*client*secret*'
           OR lower(coalesce(key, '')) GLOB '*authorization*code*'
           OR lower(coalesce(key, '')) GLOB '*private*key*'
           OR lower(coalesce(key, '')) GLOB '*bearer*'
      )
      OR lower(NEW."provenanceJson") GLOB '*bearer [a-z0-9._-][a-z0-9._-][a-z0-9._-]*'
      OR lower(NEW."provenanceJson") GLOB '*-----begin*private*key-----*'
    THEN RAISE(ABORT, 'P14: credential-like data cannot be stored in snapshot provenance') END;
  SELECT CASE WHEN NEW."sourceType" = 'DOCS_TEXT' AND (
      json_type(NEW."provenanceJson", '$.meetingId') <> 'text'
      OR json_type(NEW."provenanceJson", '$.meetingVersion') <> 'integer'
      OR json_type(NEW."provenanceJson", '$.contentSha256') <> 'text'
      OR json_type(NEW."provenanceJson", '$.exportedDocumentId') <> 'text'
      OR json_type(NEW."provenanceJson", '$.exportedBy') <> 'text'
      OR json_extract(NEW."provenanceJson", '$.meetingVersion') <> NEW."version"
      OR json_extract(NEW."provenanceJson", '$.contentSha256') <> NEW."sha256"
      OR json_extract(NEW."provenanceJson", '$.exportedDocumentId') <> NEW."externalResourceId"
      OR json_extract(NEW."provenanceJson", '$.exportedBy') <> NEW."createdById"
      OR NOT EXISTS (
        SELECT 1 FROM "Meeting" m
        WHERE m."id" = json_extract(NEW."provenanceJson", '$.meetingId')
          AND m."caseId" = NEW."caseId"
          AND m."version" = NEW."version"
      )
    ) THEN RAISE(ABORT, 'P14: Docs source snapshot is not bound to the selected case meeting version') END;
  SELECT CASE WHEN NEW."sourceType" = 'SHEETS_RANGE' AND (
      json_type(NEW."provenanceJson", '$.providerSnapshotId') <> 'text'
      OR length(json_extract(NEW."provenanceJson", '$.providerSnapshotId')) < 1
      OR length(json_extract(NEW."provenanceJson", '$.providerSnapshotId')) > 200
      OR json_extract(NEW."provenanceJson", '$.providerSnapshotId') GLOB '*[^A-Za-z0-9._:-]*'
    ) THEN RAISE(ABORT, 'P14: Sheets snapshot requires a verified provider snapshot identifier') END;
END;

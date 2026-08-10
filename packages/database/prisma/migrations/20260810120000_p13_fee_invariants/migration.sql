-- P13 follow-up migration. The original P13 migration is intentionally left
-- immutable so databases that already recorded its checksum can upgrade.
ALTER TABLE "CaseFeeConfig"
  ADD COLUMN "billingDate" DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

-- The original migration protects confirmed projections and calculation rows
-- from UPDATE. Temporarily remove only those two guards for this one-time
-- additive backfill; they are recreated below before the migration completes.
DROP TRIGGER IF EXISTS "trg_guard_confirmed_CaseFeeConfig";
DROP TRIGGER IF EXISTS "trg_block_update_CaseFeeCalculation";
DROP TRIGGER IF EXISTS "trg_guard_final_CaseFeeCalculation";

UPDATE "CaseFeeConfig"
SET "billingDate" = COALESCE("createdAt", '1970-01-01T00:00:00.000Z');

ALTER TABLE "CaseFeeCalculation"
  ADD COLUMN "sourceCalculationId" TEXT;

ALTER TABLE "CaseFeeCalculation"
  ADD COLUMN "idempotencyFingerprint" TEXT;

ALTER TABLE "CaseFeeCalculation"
  ADD COLUMN "hasSuccessFee" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "CaseFeeCalculation"
  ADD COLUMN "billingDate" DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

ALTER TABLE "CaseFeeCalculation"
  ADD COLUMN "feeConfigVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CaseFeePayment"
  ADD COLUMN "idempotencyFingerprint" TEXT;

-- The initial P13 schema had independent foreign keys but no composite tenant
-- boundary. Refuse to upgrade a populated database when any historical row
-- crosses organization/case/config/actor scope. Legacy ADJUSTMENT rows are
-- also rejected because the original API counted them as positive receipts,
-- while the corrected ledger treats them as reversals; silently reinterpreting
-- those rows would change money after the fact.
CREATE TEMP TABLE "_P13LegacyInvariantCheck" (
  "valid" INTEGER NOT NULL CHECK ("valid" = 1)
);

INSERT INTO "_P13LegacyInvariantCheck" ("valid")
SELECT 0 WHERE EXISTS (
  SELECT config."id"
  FROM "CaseFeeConfig" config
  LEFT JOIN "CaseItem" c
    ON c."id" = config."caseId" AND c."organizationId" = config."organizationId"
  WHERE c."id" IS NULL
    OR config."contractAmount" < 0
    OR config."baseAmount" < 0
    OR config."feeRateBps" < 0
    OR config."feeRateBps" > 10000
    OR config."hasSuccessFee" NOT IN (false, true)
    OR config."isTaxInclusive" NOT IN (false, true)
    OR config."status" NOT IN ('DRAFT', 'CONFIRMED')
    OR config."version" < 1
    OR (config."hasSuccessFee" = false AND config."feeRateBps" <> 0)

  UNION ALL

  SELECT calculation."id"
  FROM "CaseFeeCalculation" calculation
  LEFT JOIN "CaseItem" c
    ON c."id" = calculation."caseId" AND c."organizationId" = calculation."organizationId"
  LEFT JOIN "CaseFeeConfig" config
    ON config."id" = calculation."feeConfigId"
    AND config."caseId" = calculation."caseId"
    AND config."organizationId" = calculation."organizationId"
  LEFT JOIN "User" actor
    ON actor."id" = calculation."actorId" AND actor."organizationId" = calculation."organizationId"
  WHERE c."id" IS NULL
    OR config."id" IS NULL
    OR actor."id" IS NULL
    OR calculation."calcType" NOT IN ('ESTIMATED', 'FINAL')
    OR calculation."contractAmount" < 0
    OR calculation."baseAmount" < 0
    OR calculation."feeRateBps" < 0
    OR calculation."feeRateBps" > 10000
    OR calculation."isTaxInclusive" NOT IN (false, true)
    OR calculation."calculatedFee" < 0
    OR calculation."taxAmount" < 0
    OR calculation."totalClaimFee" < 0
    -- The parent release could only create V1. A pre-existing V3 label is a
    -- raw-write forgery, not a compatible historical row.
    OR calculation."formulaVersion" <> 'HALF_UP_BPS_V1'

  UNION ALL

  SELECT payment."id"
  FROM "CaseFeePayment" payment
  LEFT JOIN "CaseItem" c
    ON c."id" = payment."caseId" AND c."organizationId" = payment."organizationId"
  LEFT JOIN "CaseFeeConfig" config
    ON config."id" = payment."feeConfigId"
    AND config."caseId" = payment."caseId"
    AND config."organizationId" = payment."organizationId"
  LEFT JOIN "User" actor
    ON actor."id" = payment."actorId" AND actor."organizationId" = payment."organizationId"
  WHERE c."id" IS NULL
    OR config."id" IS NULL
    OR actor."id" IS NULL
    OR config."status" <> 'CONFIRMED'
    OR payment."paymentType" NOT IN ('PARTIAL', 'FULL')
    OR payment."amount" <= 0
    OR payment."invoiceStatus" NOT IN ('NOT_ISSUED', 'ISSUED', 'EXEMPT')
    OR (
      payment."invoiceStatus" = 'ISSUED' AND (
        payment."invoiceIssuedAt" IS NULL OR
        payment."invoiceNumber" IS NULL OR
        trim(payment."invoiceNumber") = ''
      )
    )
    OR NOT EXISTS (
      SELECT 1 FROM "CaseFeeCalculation" final
      WHERE final."organizationId" = payment."organizationId"
        AND final."caseId" = payment."caseId"
        AND final."feeConfigId" = payment."feeConfigId"
        AND final."calcType" = 'FINAL'
    )

  UNION ALL

  SELECT MIN(payment."id")
  FROM "CaseFeePayment" payment
  GROUP BY payment."organizationId", payment."caseId", payment."feeConfigId"
  HAVING SUM(payment."amount") > COALESCE((
    SELECT final."totalClaimFee"
    FROM "CaseFeeCalculation" final
    WHERE final."organizationId" = payment."organizationId"
      AND final."caseId" = payment."caseId"
      AND final."feeConfigId" = payment."feeConfigId"
      AND final."calcType" = 'FINAL'
    ORDER BY final."createdAt" DESC, final.rowid DESC
    LIMIT 1
  ), -1)

  UNION ALL

  SELECT audit."id"
  FROM "CaseFeeAudit" audit
  LEFT JOIN "CaseItem" c
    ON c."id" = audit."caseId" AND c."organizationId" = audit."organizationId"
  LEFT JOIN "User" actor
    ON actor."id" = audit."actorId" AND actor."organizationId" = audit."organizationId"
  WHERE c."id" IS NULL OR actor."id" IS NULL OR audit."unpaidBalance" < 0
);

DROP TABLE "_P13LegacyInvariantCheck";

DROP INDEX IF EXISTS "CaseFeeCalculation_idempotencyKey_key";
DROP INDEX IF EXISTS "CaseFeePayment_idempotencyKey_key";

CREATE UNIQUE INDEX "CaseFeeCalculation_organizationId_caseId_actorId_idempotencyKey_key"
  ON "CaseFeeCalculation"("organizationId", "caseId", "actorId", "idempotencyKey");
CREATE INDEX "CaseFeeCalculation_sourceCalculationId_idx"
  ON "CaseFeeCalculation"("sourceCalculationId");
CREATE UNIQUE INDEX "CaseFeePayment_organizationId_caseId_actorId_idempotencyKey_key"
  ON "CaseFeePayment"("organizationId", "caseId", "actorId", "idempotencyKey");

-- Recover provenance only when the legacy FINAL can be tied to an exact prior
-- estimate, a different assigned author, and an assigned Director/CEO. Rows
-- that cannot satisfy this proof remain historical but non-authoritative.
UPDATE "CaseFeeCalculation"
SET "sourceCalculationId" = (
  SELECT source."id"
  FROM "CaseFeeCalculation" source
  JOIN "CaseAssignment" sourceAssignment
    ON sourceAssignment."caseId" = source."caseId" AND sourceAssignment."userId" = source."actorId"
  JOIN "User" approver ON approver."id" = "CaseFeeCalculation"."actorId"
  JOIN "CaseAssignment" approverAssignment
    ON approverAssignment."caseId" = "CaseFeeCalculation"."caseId"
    AND approverAssignment."userId" = approver."id"
  JOIN "UserRole" approverRole ON approverRole."userId" = approver."id"
  JOIN "Role" role ON role."id" = approverRole."roleId"
  WHERE "CaseFeeCalculation"."calcType" = 'FINAL'
    AND source."calcType" = 'ESTIMATED'
    AND source."organizationId" = "CaseFeeCalculation"."organizationId"
    AND source."caseId" = "CaseFeeCalculation"."caseId"
    AND source."feeConfigId" = "CaseFeeCalculation"."feeConfigId"
    AND source."actorId" <> "CaseFeeCalculation"."actorId"
    AND source."contractAmount" = "CaseFeeCalculation"."contractAmount"
    AND source."baseAmount" = "CaseFeeCalculation"."baseAmount"
    AND source."feeRateBps" = "CaseFeeCalculation"."feeRateBps"
    AND source."isTaxInclusive" = "CaseFeeCalculation"."isTaxInclusive"
    AND source."calculatedFee" = "CaseFeeCalculation"."calculatedFee"
    AND source."taxAmount" = "CaseFeeCalculation"."taxAmount"
    AND source."totalClaimFee" = "CaseFeeCalculation"."totalClaimFee"
    AND source."formulaVersion" = "CaseFeeCalculation"."formulaVersion"
    AND source."createdAt" <= "CaseFeeCalculation"."createdAt"
    AND approver."organizationId" = "CaseFeeCalculation"."organizationId"
    AND LOWER(role."name") IN ('director', 'ceo')
  ORDER BY source."createdAt" DESC, source.rowid DESC
  LIMIT 1
)
WHERE "calcType" = 'FINAL';

UPDATE "CaseFeeCalculation"
SET
  "hasSuccessFee" = COALESCE((
    SELECT config."hasSuccessFee" FROM "CaseFeeConfig" config
    WHERE config."id" = "CaseFeeCalculation"."feeConfigId"
  ), true),
  "billingDate" = COALESCE((
    SELECT config."billingDate" FROM "CaseFeeConfig" config
    WHERE config."id" = "CaseFeeCalculation"."feeConfigId"
  ), "createdAt"),
  -- Legacy ESTIMATED rows advanced the config once per estimate. FINAL rows
  -- inherit their source estimate's version; later payment projection bumps
  -- must not alter either immutable calculation snapshot.
  "feeConfigVersion" = COALESCE((
    SELECT COUNT(*)
    FROM "CaseFeeCalculation" prior
    WHERE prior."feeConfigId" = "CaseFeeCalculation"."feeConfigId"
      AND prior."calcType" = 'ESTIMATED'
      AND prior.rowid <= COALESCE((
        SELECT source.rowid
        FROM "CaseFeeCalculation" source
        WHERE "CaseFeeCalculation"."calcType" = 'FINAL'
          AND source."id" = "CaseFeeCalculation"."sourceCalculationId"
          AND source."feeConfigId" = "CaseFeeCalculation"."feeConfigId"
          AND source."calcType" = 'ESTIMATED'
      ), "CaseFeeCalculation".rowid)
  ), 1);

-- An open legacy CONFIRMED projection is not allowed to authorize new money or
-- closure until the current V3 formula has an independently sourced FINAL.
-- Keep every historical calculation/payment row, but invalidate optimistic
-- clients and require an explicit recalculation/re-approval cycle.
UPDATE "CaseFeeConfig"
SET "status" = 'DRAFT', "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'CONFIRMED'
  AND EXISTS (
    SELECT 1 FROM "CaseItem" c
    WHERE c."id" = "CaseFeeConfig"."caseId"
      AND c."organizationId" = "CaseFeeConfig"."organizationId"
      AND c."status" <> 'CLOSED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "CaseFeeCalculation" final
    WHERE final."organizationId" = "CaseFeeConfig"."organizationId"
      AND final."caseId" = "CaseFeeConfig"."caseId"
      AND final."feeConfigId" = "CaseFeeConfig"."id"
      AND final."calcType" = 'FINAL'
      AND final."formulaVersion" = 'KRW_INTEGER_HALF_UP_BPS_TAX_V3'
      AND final."sourceCalculationId" IS NOT NULL
  );

CREATE TRIGGER "trg_block_update_CaseFeeCalculation"
BEFORE UPDATE ON "CaseFeeCalculation"
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeCalculation is append-only and cannot be updated');
END;

-- Restore the same-organization/case boundary that the initial P13 migration
-- did not enforce at the database layer.
CREATE TRIGGER "trg_scope_CaseFeeConfig"
BEFORE INSERT ON "CaseFeeConfig"
WHEN NOT EXISTS (
  SELECT 1 FROM "CaseItem" c
  WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."deletedAt" IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeConfig organization/case scope mismatch');
END;

CREATE TRIGGER "trg_scope_CaseFeeCalculation"
BEFORE INSERT ON "CaseFeeCalculation"
WHEN NOT EXISTS (
  SELECT 1 FROM "CaseItem" c
  JOIN "CaseFeeConfig" f ON f."id" = NEW."feeConfigId"
  JOIN "User" u ON u."id" = NEW."actorId"
  JOIN "CaseAssignment" assignment ON assignment."caseId" = NEW."caseId" AND assignment."userId" = NEW."actorId"
  WHERE c."id" = NEW."caseId"
    AND c."organizationId" = NEW."organizationId"
    AND c."deletedAt" IS NULL
    AND f."caseId" = NEW."caseId"
    AND f."organizationId" = NEW."organizationId"
    AND u."organizationId" = NEW."organizationId"
    AND u."isActive" = true
)
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeCalculation organization/case/config/actor scope mismatch');
END;

CREATE TRIGGER "trg_scope_CaseFeePayment"
BEFORE INSERT ON "CaseFeePayment"
WHEN NOT EXISTS (
  SELECT 1 FROM "CaseItem" c
  JOIN "CaseFeeConfig" f ON f."id" = NEW."feeConfigId"
  JOIN "User" u ON u."id" = NEW."actorId"
  JOIN "CaseAssignment" assignment ON assignment."caseId" = NEW."caseId" AND assignment."userId" = NEW."actorId"
  WHERE c."id" = NEW."caseId"
    AND c."organizationId" = NEW."organizationId"
    AND c."deletedAt" IS NULL
    AND f."caseId" = NEW."caseId"
    AND f."organizationId" = NEW."organizationId"
    AND u."organizationId" = NEW."organizationId"
    AND u."isActive" = true
)
BEGIN
  SELECT RAISE(ABORT, 'CaseFeePayment organization/case/config/actor scope mismatch');
END;

CREATE TRIGGER "trg_scope_CaseFeeAudit"
BEFORE INSERT ON "CaseFeeAudit"
WHEN NOT EXISTS (
  SELECT 1 FROM "CaseItem" c
  JOIN "User" u ON u."id" = NEW."actorId"
  JOIN "CaseAssignment" assignment ON assignment."caseId" = NEW."caseId" AND assignment."userId" = NEW."actorId"
  WHERE c."id" = NEW."caseId"
    AND c."organizationId" = NEW."organizationId"
    AND c."deletedAt" IS NULL
    AND u."organizationId" = NEW."organizationId"
    AND u."isActive" = true
)
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeAudit organization/case/actor scope mismatch');
END;

-- Closure is a database-level financial boundary, not only an API policy.
-- No later raw write may change the fee terms, calculations, or receipts that
-- justified the CLOSED decision.
CREATE TRIGGER "trg_guard_closed_CaseFeeConfig_insert"
BEFORE INSERT ON "CaseFeeConfig"
WHEN EXISTS (
  SELECT 1 FROM "CaseItem" c
  WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'CLOSED'
)
BEGIN
  SELECT RAISE(ABORT, 'Closed cases reject fee configuration changes');
END;

CREATE TRIGGER "trg_guard_closed_CaseFeeConfig_update"
BEFORE UPDATE ON "CaseFeeConfig"
WHEN EXISTS (
  SELECT 1 FROM "CaseItem" c
  WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'CLOSED'
)
BEGIN
  SELECT RAISE(ABORT, 'Closed cases reject fee configuration changes');
END;

CREATE TRIGGER "trg_guard_closed_CaseFeeCalculation"
BEFORE INSERT ON "CaseFeeCalculation"
WHEN EXISTS (
  SELECT 1 FROM "CaseItem" c
  WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'CLOSED'
)
BEGIN
  SELECT RAISE(ABORT, 'Closed cases reject fee calculations');
END;

CREATE TRIGGER "trg_guard_closed_CaseFeePayment"
BEFORE INSERT ON "CaseFeePayment"
WHEN EXISTS (
  SELECT 1 FROM "CaseItem" c
  WHERE c."id" = NEW."caseId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'CLOSED'
)
BEGIN
  SELECT RAISE(ABORT, 'Closed cases reject fee payments');
END;

CREATE TRIGGER "trg_guard_terms_insert_CaseFeeConfig"
BEFORE INSERT ON "CaseFeeConfig"
WHEN
  NEW."contractAmount" < 0 OR
  NEW."baseAmount" < 0 OR
  NEW."feeRateBps" < 0 OR
  NEW."feeRateBps" > 10000 OR
  NEW."status" NOT IN ('DRAFT', 'CONFIRMED') OR
  NEW."version" < 1 OR
  NEW."billingDate" IS NULL OR
  NEW."billingDate" = '1970-01-01T00:00:00.000Z' OR
  NEW."hasSuccessFee" NOT IN (false, true) OR
  NEW."isTaxInclusive" NOT IN (false, true) OR
  (NEW."hasSuccessFee" = false AND NEW."feeRateBps" <> 0)
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeConfig requires a billing date and zero rate when success fee is disabled');
END;

CREATE TRIGGER "trg_scope_update_CaseFeeConfig"
BEFORE UPDATE ON "CaseFeeConfig"
WHEN
  NEW."organizationId" <> OLD."organizationId" OR
  NEW."caseId" <> OLD."caseId" OR
  NOT EXISTS (
    SELECT 1 FROM "CaseItem" c
    WHERE c."id" = NEW."caseId"
      AND c."organizationId" = NEW."organizationId"
      AND c."deletedAt" IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeConfig organization/case scope is immutable');
END;

CREATE TRIGGER "trg_guard_terms_update_CaseFeeConfig"
BEFORE UPDATE ON "CaseFeeConfig"
WHEN
  NEW."contractAmount" < 0 OR
  NEW."baseAmount" < 0 OR
  NEW."feeRateBps" < 0 OR
  NEW."feeRateBps" > 10000 OR
  NEW."status" NOT IN ('DRAFT', 'CONFIRMED') OR
  NEW."version" < 1 OR
  NEW."billingDate" IS NULL OR
  NEW."billingDate" = '1970-01-01T00:00:00.000Z' OR
  NEW."hasSuccessFee" NOT IN (false, true) OR
  NEW."isTaxInclusive" NOT IN (false, true) OR
  (NEW."hasSuccessFee" = false AND NEW."feeRateBps" <> 0)
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeConfig requires a billing date and zero rate when success fee is disabled');
END;

-- Every draft edit advances exactly one version. A DRAFT -> CONFIRMED
-- transition is only legal after the exact immutable FINAL snapshot exists.
CREATE TRIGGER "trg_guard_draft_CaseFeeConfig"
BEFORE UPDATE ON "CaseFeeConfig"
WHEN OLD."status" = 'DRAFT' AND (
  NEW."version" <> OLD."version" + 1 OR
  (
    NEW."status" = 'CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM "CaseFeeCalculation" final
      WHERE final."feeConfigId" = NEW."id"
        AND final."organizationId" = NEW."organizationId"
        AND final."caseId" = NEW."caseId"
        AND final."calcType" = 'FINAL'
        AND final."formulaVersion" = 'KRW_INTEGER_HALF_UP_BPS_TAX_V3'
        AND final."sourceCalculationId" IS NOT NULL
        AND final."contractAmount" = NEW."contractAmount"
        AND final."hasSuccessFee" = NEW."hasSuccessFee"
        AND final."billingDate" = NEW."billingDate"
        AND final."baseAmount" = NEW."baseAmount"
        AND final."feeRateBps" = NEW."feeRateBps"
        AND final."isTaxInclusive" = NEW."isTaxInclusive"
        AND final."feeConfigVersion" = OLD."version"
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Draft CaseFeeConfig transition requires one exact final snapshot and next version');
END;

CREATE TRIGGER "trg_guard_confirmed_CaseFeeConfig"
BEFORE UPDATE ON "CaseFeeConfig"
WHEN OLD."status" = 'CONFIRMED' AND (
  NEW."organizationId" <> OLD."organizationId" OR
  NEW."caseId" <> OLD."caseId" OR
  NEW."contractAmount" <> OLD."contractAmount" OR
  NEW."hasSuccessFee" <> OLD."hasSuccessFee" OR
  NEW."billingDate" <> OLD."billingDate" OR
  NEW."baseAmount" <> OLD."baseAmount" OR
  NEW."feeRateBps" <> OLD."feeRateBps" OR
  NEW."isTaxInclusive" <> OLD."isTaxInclusive" OR
  NEW."status" <> OLD."status" OR
  NEW."version" <> OLD."version" + 1
)
BEGIN
  SELECT RAISE(ABORT, 'Confirmed CaseFeeConfig financial terms are immutable');
END;

-- Every estimate and final snapshot must match the current DRAFT config and the
-- exact integer half-up formula. The split quotient avoids SQLite INTEGER
-- overflow for the API's full KRW range.
CREATE TRIGGER "trg_guard_terms_CaseFeeCalculation"
BEFORE INSERT ON "CaseFeeCalculation"
WHEN
  NEW."calcType" NOT IN ('ESTIMATED', 'FINAL') OR
  NEW."contractAmount" < 0 OR
  NEW."baseAmount" < 0 OR
  NEW."feeRateBps" < 0 OR
  NEW."feeRateBps" > 10000 OR
  NEW."calculatedFee" < 0 OR
  NEW."taxAmount" < 0 OR
  NEW."totalClaimFee" < 0 OR
  NEW."feeConfigVersion" < 1 OR
  NEW."billingDate" IS NULL OR
  NEW."billingDate" = '1970-01-01T00:00:00.000Z' OR
  NEW."hasSuccessFee" NOT IN (false, true) OR
  NEW."isTaxInclusive" NOT IN (false, true) OR
  NEW."formulaVersion" <> 'KRW_INTEGER_HALF_UP_BPS_TAX_V3' OR
  NOT EXISTS (
    SELECT 1 FROM "CaseFeeConfig" config
    WHERE config."id" = NEW."feeConfigId"
      AND config."organizationId" = NEW."organizationId"
      AND config."caseId" = NEW."caseId"
      AND config."status" = 'DRAFT'
      AND config."version" = NEW."feeConfigVersion"
      AND config."contractAmount" = NEW."contractAmount"
      AND config."hasSuccessFee" = NEW."hasSuccessFee"
      AND config."billingDate" = NEW."billingDate"
      AND config."baseAmount" = NEW."baseAmount"
      AND config."feeRateBps" = NEW."feeRateBps"
      AND config."isTaxInclusive" = NEW."isTaxInclusive"
  ) OR
  (
    NEW."hasSuccessFee" = false AND (
      NEW."feeRateBps" <> 0 OR
      NEW."calculatedFee" <> 0 OR
      NEW."taxAmount" <> 0 OR
      NEW."totalClaimFee" <> 0
    )
  ) OR
  (
    NEW."hasSuccessFee" = true AND NEW."isTaxInclusive" = false AND (
      NEW."calculatedFee" <> (
        (NEW."baseAmount" / 10000) * NEW."feeRateBps" +
        (((NEW."baseAmount" % 10000) * NEW."feeRateBps" + 5000) / 10000)
      ) OR
      NEW."taxAmount" <> ((NEW."calculatedFee" + 5) / 10) OR
      NEW."totalClaimFee" <> NEW."calculatedFee" + NEW."taxAmount"
    )
  ) OR
  (
    NEW."hasSuccessFee" = true AND NEW."isTaxInclusive" = true AND (
      NEW."totalClaimFee" <> (
        (NEW."baseAmount" / 10000) * NEW."feeRateBps" +
        (((NEW."baseAmount" % 10000) * NEW."feeRateBps" + 5000) / 10000)
      ) OR
      NEW."calculatedFee" <> ((NEW."totalClaimFee" * 10 + 5) / 11) OR
      NEW."taxAmount" <> NEW."totalClaimFee" - NEW."calculatedFee"
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'CaseFeeCalculation terms or integer formula mismatch');
END;

-- A FINAL row must be the exact snapshot of an ESTIMATED row authored by a
-- different assigned actor. The general terms trigger above independently
-- validates both rows against the financial formula.
CREATE TRIGGER "trg_guard_final_CaseFeeCalculation"
BEFORE INSERT ON "CaseFeeCalculation"
WHEN NEW."calcType" = 'FINAL' AND (
  NEW."sourceCalculationId" IS NULL OR
  NOT EXISTS (
    SELECT 1 FROM "CaseFeeCalculation" source
    WHERE source."id" = NEW."sourceCalculationId"
      AND source."calcType" = 'ESTIMATED'
      AND source."organizationId" = NEW."organizationId"
      AND source."caseId" = NEW."caseId"
      AND source."feeConfigId" = NEW."feeConfigId"
      AND source."actorId" <> NEW."actorId"
      AND source."contractAmount" = NEW."contractAmount"
      AND source."hasSuccessFee" = NEW."hasSuccessFee"
      AND source."billingDate" = NEW."billingDate"
      AND source."baseAmount" = NEW."baseAmount"
      AND source."feeRateBps" = NEW."feeRateBps"
      AND source."isTaxInclusive" = NEW."isTaxInclusive"
      AND source."calculatedFee" = NEW."calculatedFee"
      AND source."taxAmount" = NEW."taxAmount"
      AND source."totalClaimFee" = NEW."totalClaimFee"
      AND source."formulaVersion" = NEW."formulaVersion"
      AND source."feeConfigVersion" = NEW."feeConfigVersion"
  ) OR
  NOT EXISTS (
    SELECT 1
    FROM "User" approver
    JOIN "CaseAssignment" assignment
      ON assignment."userId" = approver."id" AND assignment."caseId" = NEW."caseId"
    JOIN "UserRole" userRole ON userRole."userId" = approver."id"
    JOIN "Role" role ON role."id" = userRole."roleId"
    WHERE approver."id" = NEW."actorId"
      AND approver."organizationId" = NEW."organizationId"
      AND approver."isActive" = true
      AND LOWER(role."name") IN ('director', 'ceo')
  ) OR
  EXISTS (
    SELECT 1 FROM "CaseFeeCalculation" final
    WHERE final."caseId" = NEW."caseId"
      AND final."calcType" = 'FINAL'
      AND final."formulaVersion" = 'KRW_INTEGER_HALF_UP_BPS_TAX_V3'
      AND final."sourceCalculationId" IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Final fee approval requires one exact independent estimate snapshot');
END;

CREATE TRIGGER "trg_confirm_CaseFeeConfig_after_final"
AFTER INSERT ON "CaseFeeCalculation"
WHEN NEW."calcType" = 'FINAL'
BEGIN
  UPDATE "CaseFeeConfig"
  SET "status" = 'CONFIRMED', "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."feeConfigId"
    AND "organizationId" = NEW."organizationId"
    AND "caseId" = NEW."caseId"
    AND "status" = 'DRAFT'
    AND "version" = NEW."feeConfigVersion";
  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'Final fee approval could not atomically confirm its configuration')
  END;
END;

CREATE TRIGGER "trg_guard_input_CaseFeePayment"
BEFORE INSERT ON "CaseFeePayment"
WHEN
  NEW."paymentType" NOT IN ('PARTIAL', 'FULL', 'ADJUSTMENT') OR
  NEW."amount" <= 0 OR
  NEW."invoiceStatus" NOT IN ('NOT_ISSUED', 'ISSUED', 'EXEMPT') OR
  (NEW."invoiceStatus" = 'ISSUED' AND (NEW."invoiceIssuedAt" IS NULL OR NEW."invoiceNumber" IS NULL OR trim(NEW."invoiceNumber") = ''))
BEGIN
  SELECT RAISE(ABORT, 'CaseFeePayment input constraint violation');
END;

-- Payment and reversal rows cannot bypass the confirmed total through raw SQL.
CREATE TRIGGER "trg_guard_balance_CaseFeePayment"
BEFORE INSERT ON "CaseFeePayment"
WHEN
  NOT EXISTS (
    SELECT 1 FROM "CaseFeeConfig" config
    WHERE config."id" = NEW."feeConfigId"
      AND config."organizationId" = NEW."organizationId"
      AND config."caseId" = NEW."caseId"
      AND config."status" = 'CONFIRMED'
  ) OR
  NOT EXISTS (
    SELECT 1 FROM "CaseFeeCalculation" final
    WHERE final."caseId" = NEW."caseId"
      AND final."feeConfigId" = NEW."feeConfigId"
      AND final."organizationId" = NEW."organizationId"
      AND final."calcType" = 'FINAL'
      AND final."formulaVersion" = 'KRW_INTEGER_HALF_UP_BPS_TAX_V3'
      AND final."sourceCalculationId" IS NOT NULL
  ) OR
  (
    NEW."paymentType" = 'ADJUSTMENT' AND NEW."amount" > COALESCE((
      SELECT SUM(CASE WHEN payment."paymentType" = 'ADJUSTMENT' THEN -payment."amount" ELSE payment."amount" END)
      FROM "CaseFeePayment" payment WHERE payment."caseId" = NEW."caseId"
    ), 0)
  ) OR
  (
    NEW."paymentType" <> 'ADJUSTMENT' AND NEW."amount" > (
      SELECT final."totalClaimFee" FROM "CaseFeeCalculation" final
      WHERE final."caseId" = NEW."caseId"
        AND final."feeConfigId" = NEW."feeConfigId"
        AND final."organizationId" = NEW."organizationId"
        AND final."calcType" = 'FINAL'
        AND final."formulaVersion" = 'KRW_INTEGER_HALF_UP_BPS_TAX_V3'
        AND final."sourceCalculationId" IS NOT NULL
      ORDER BY final."createdAt" DESC LIMIT 1
    ) - COALESCE((
      SELECT SUM(CASE WHEN payment."paymentType" = 'ADJUSTMENT' THEN -payment."amount" ELSE payment."amount" END)
      FROM "CaseFeePayment" payment WHERE payment."caseId" = NEW."caseId"
    ), 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'Payment exceeds confirmed fee balance or reversal scope');
END;

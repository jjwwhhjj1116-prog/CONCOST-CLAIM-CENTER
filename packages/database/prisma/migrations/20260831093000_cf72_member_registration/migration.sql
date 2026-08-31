CREATE TABLE IF NOT EXISTS "UserRegistrationRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "loginId" TEXT NOT NULL COLLATE NOCASE,
  "displayName" TEXT NOT NULL,
  "email" TEXT NOT NULL COLLATE NOCASE,
  "passwordHash" TEXT NOT NULL,
  "requestedRole" TEXT NOT NULL DEFAULT 'staff',
  "requestNote" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UserRegistrationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserRegistrationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CHECK ("requestedRole" IN ('staff','reviewer','pm')),
  CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
  CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserRegistrationRequest_pending_login_key"
  ON "UserRegistrationRequest" ("organizationId","loginId") WHERE "status"='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS "UserRegistrationRequest_pending_email_key"
  ON "UserRegistrationRequest" ("organizationId","email") WHERE "status"='PENDING';
CREATE INDEX IF NOT EXISTS "UserRegistrationRequest_status_createdAt_idx"
  ON "UserRegistrationRequest" ("organizationId","status","createdAt" DESC);

CREATE TRIGGER IF NOT EXISTS "UserRegistrationRequest_delete_guard"
BEFORE DELETE ON "UserRegistrationRequest"
BEGIN
  SELECT RAISE(ABORT, 'registration requests cannot be physically deleted');
END;

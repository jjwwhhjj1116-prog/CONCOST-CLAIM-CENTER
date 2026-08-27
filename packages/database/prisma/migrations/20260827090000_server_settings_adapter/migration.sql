CREATE TABLE "ServerSetting" (
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "settingKey" TEXT NOT NULL,
  "valueJson" TEXT NOT NULL DEFAULT '{}',
  "secretCiphertext" TEXT,
  "secretIv" TEXT,
  "secretTag" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("organizationId", "ownerId", "settingKey"),
  CONSTRAINT "ServerSetting_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ServerSetting_organizationId_settingKey_idx"
  ON "ServerSetting" ("organizationId", "settingKey");

CREATE TRIGGER "ServerSetting_version_update_guard"
BEFORE UPDATE ON "ServerSetting"
FOR EACH ROW
WHEN NEW."version" <> OLD."version" + 1
BEGIN
  SELECT RAISE(ABORT, 'ServerSetting version must increment by exactly one');
END;

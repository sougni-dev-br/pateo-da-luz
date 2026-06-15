CREATE TABLE IF NOT EXISTS "ImportConflictDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conflictKey" TEXT NOT NULL UNIQUE,
  "entityType" TEXT NOT NULL,
  "conflictType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "code" TEXT,
  "normalizedName" TEXT,
  "incomingName" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ImportConflictDecision_entityType_idx"
  ON "ImportConflictDecision"("entityType");

CREATE INDEX IF NOT EXISTS "ImportConflictDecision_conflictType_idx"
  ON "ImportConflictDecision"("conflictType");

CREATE INDEX IF NOT EXISTS "ImportConflictDecision_code_idx"
  ON "ImportConflictDecision"("code");

CREATE INDEX IF NOT EXISTS "ImportConflictDecision_normalizedName_idx"
  ON "ImportConflictDecision"("normalizedName");

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);

UPDATE "User"
SET "passwordChangedAt" = COALESCE("passwordChangedAt", "updatedAt", CURRENT_TIMESTAMP)
WHERE "passwordChangedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "User_lockedUntil_idx" ON "User"("lockedUntil");

ALTER TABLE "RevenueEntry"
ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT;

CREATE INDEX IF NOT EXISTS "RevenueEntry_sourcePlatform_idx" ON "RevenueEntry"("sourcePlatform");

-- Calls the phone system reported to numbers no lead has yet: kept until the SDR makes or picks the lead.
CREATE TABLE "LeadUnmatchedCall" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "phone" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "disposition" TEXT NOT NULL DEFAULT 'NO_ANSWER',
    "provider" TEXT NOT NULL DEFAULT 'TALKLOOP',
    "externalId" TEXT NOT NULL,
    "recordingFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadUnmatchedCall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadUnmatchedCall_companyId_externalId_key" ON "LeadUnmatchedCall"("companyId", "externalId");
CREATE INDEX "LeadUnmatchedCall_companyId_phone_idx" ON "LeadUnmatchedCall"("companyId", "phone");
CREATE INDEX "LeadUnmatchedCall_companyId_userId_at_idx" ON "LeadUnmatchedCall"("companyId", "userId", "at");
ALTER TABLE "LeadUnmatchedCall" ADD CONSTRAINT "LeadUnmatchedCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadUnmatchedCall" ADD CONSTRAINT "LeadUnmatchedCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Company wall for the new table (src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_LeadUnmatchedCall"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadUnmatchedCall row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadUnmatchedCall.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadUnmatchedCall_company_wall" ON "LeadUnmatchedCall";
CREATE TRIGGER "LeadUnmatchedCall_company_wall" BEFORE INSERT OR UPDATE ON "LeadUnmatchedCall" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadUnmatchedCall"();

-- Lead Dialer, ITAD revised spec (30 Oct 2026): touches (attempts) per lead, Lead Dialer tasks as
-- My To-Do entries linked to a lead, and the job title and "Assigned To" from the export.
-- Everything is added; nothing existing changes. down.sql (next to this file) takes it back out.

-- AlterTable
ALTER TABLE "DialerLead" ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "jobTitle" TEXT;

-- AlterTable
ALTER TABLE "WorkLogEntry" ADD COLUMN     "autoReason" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "dialerLeadId" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "origin" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "remindMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "remindersSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "taskKind" TEXT;

-- CreateTable
CREATE TABLE "DialerTouch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'EXACT',
    "status" TEXT,
    "importId" TEXT,
    "mergedImportId" TEXT,
    "userId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialerTouch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DialerTouch_leadId_at_idx" ON "DialerTouch"("leadId", "at");

-- CreateIndex
CREATE INDEX "DialerTouch_companyId_idx" ON "DialerTouch"("companyId");

-- CreateIndex
CREATE INDEX "WorkLogEntry_dialerLeadId_idx" ON "WorkLogEntry"("dialerLeadId");

-- CreateIndex
CREATE INDEX "WorkLogEntry_userId_dueAt_idx" ON "WorkLogEntry"("userId", "dueAt");

-- AddForeignKey
ALTER TABLE "DialerTouch" ADD CONSTRAINT "DialerTouch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerTouch" ADD CONSTRAINT "DialerTouch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DialerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialerTouch" ADD CONSTRAINT "DialerTouch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogEntry" ADD CONSTRAINT "WorkLogEntry_dialerLeadId_fkey" FOREIGN KEY ("dialerLeadId") REFERENCES "DialerLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The job title and "Assigned To" for leads already imported, from the row each lead keeps.
UPDATE "DialerLead" SET
  "jobTitle" = NULLIF(TRIM(COALESCE("raw"->>'Title', "raw"->>'Job Title', "raw"->>'JobTitle', "raw"->>'title', "raw"->>'Designation', "raw"->>'Position')), ''),
  "assignedTo" = NULLIF(TRIM(COALESCE("raw"->>'Assigned To', "raw"->>'Assigned to', "raw"->>'AssignedTo', "raw"->>'Lead Owner', "raw"->>'Owner')), '')
WHERE "raw" IS NOT NULL;

-- Company walls for the new table, and for the to-do's new link to a lead.
CREATE OR REPLACE FUNCTION "mq_wall_DialerTouch"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a DialerTouch row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "DialerLead" WHERE "id" = NEW."leadId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "DialerLead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: DialerTouch.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: DialerTouch.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "DialerTouch_company_wall" ON "DialerTouch";
CREATE TRIGGER "DialerTouch_company_wall" BEFORE INSERT OR UPDATE ON "DialerTouch" FOR EACH ROW EXECUTE FUNCTION "mq_wall_DialerTouch"();

CREATE OR REPLACE FUNCTION "mq_wall_WorkLogEntry"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a WorkLogEntry row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    IF c IS NULL AND NEW."dialerLeadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "DialerLead" WHERE "id" = NEW."dialerLeadId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: WorkLogEntry.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."dialerLeadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."dialerLeadId" IS DISTINCT FROM OLD."dialerLeadId") THEN
    SELECT "companyId" INTO c FROM "DialerLead" WHERE "id" = NEW."dialerLeadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: WorkLogEntry.dialerLeadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "WorkLogEntry_company_wall" ON "WorkLogEntry";
CREATE TRIGGER "WorkLogEntry_company_wall" BEFORE INSERT OR UPDATE ON "WorkLogEntry" FOR EACH ROW EXECUTE FUNCTION "mq_wall_WorkLogEntry"();

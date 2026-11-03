-- Lead Management like LeadWise, and the CMR flow inside it: lead details, pipelines per business, calls, comments, agent tasks, lists, the daily report; the CMR department kind.
-- AlterEnum
ALTER TYPE "DepartmentType" ADD VALUE IF NOT EXISTS 'CMR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_TASK';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_DECISION';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "callsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "employees" TEXT,
ADD COLUMN     "existingCustomer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ext" TEXT,
ADD COLUMN     "firstCallAt" TIMESTAMP(3),
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "lastCallAt" TIMESTAMP(3),
ADD COLUMN     "lostNote" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "nextStepDate" TIMESTAMP(3),
ADD COLUMN     "orgKey" TEXT,
ADD COLUMN     "owner" TEXT NOT NULL DEFAULT 'REP',
ADD COLUMN     "phoneE164" TEXT,
ADD COLUMN     "productInfo" TEXT,
ADD COLUMN     "prohibited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recipientEmail" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "secondaryContact" TEXT,
ADD COLUMN     "secondaryEmail" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "website" TEXT,
ADD COLUMN     "websiteKey" TEXT,
ADD COLUMN     "zip" TEXT;

-- AlterTable
ALTER TABLE "LeadBusiness" ADD COLUMN     "headId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "pipeline" JSONB,
ADD COLUMN     "settings" JSONB;

-- CreateTable
CREATE TABLE "LeadCmr" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "contactRole" TEXT,
    "decisionMaker" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "decisionMakerName" TEXT,
    "dmAgreed" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "handlesAlkaline" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "material" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "materialForm" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lbsPerMonth" DOUBLE PRECISION,
    "lbsPerShipment" DOUBLE PRECISION,
    "currentVendor" TEXT,
    "paysToday" DOUBLE PRECISION,
    "paysUnit" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "vendorRelatedParty" BOOLEAN NOT NULL DEFAULT false,
    "usesBatteryNetwork" BOOLEAN NOT NULL DEFAULT false,
    "sortsAlkaline" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "shipsLtl" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "nextShipmentDate" TIMESTAMP(3),
    "pickupCity" TEXT,
    "freight" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "jesseInputNeeded" BOOLEAN NOT NULL DEFAULT false,
    "jesseAsk" TEXT,
    "jesseComment" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "qualifyRequestedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "qualifiedById" TEXT,
    "jesseDecision" TEXT,
    "jesseDecidedAt" TIMESTAMP(3),
    "meetingSlots" JSONB,
    "meetingAt" TIMESTAMP(3),
    "meetingTz" TEXT,
    "meetingLink" TEXT,
    "inviteSentAt" TIMESTAMP(3),
    "reconfirmedAt" TIMESTAMP(3),
    "meetingBrief" TEXT,
    "meetingOutcome" TEXT,
    "meetingOutcomeAt" TIMESTAMP(3),
    "infoSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCmr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCall" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "disposition" TEXT NOT NULL DEFAULT 'CONNECTED',
    "summary" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT,
    "consentGiven" BOOLEAN,
    "recordingUrl" TEXT,
    "recordingKept" BOOLEAN NOT NULL DEFAULT true,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadComment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "callId" TEXT,
    "atSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadListEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDailyReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dials" INTEGER NOT NULL DEFAULT 0,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "voicemails" INTEGER NOT NULL DEFAULT 0,
    "emails" INTEGER NOT NULL DEFAULT 0,
    "interested" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "counted" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCmr_leadId_key" ON "LeadCmr"("leadId");

-- CreateIndex
CREATE INDEX "LeadCmr_companyId_jesseInputNeeded_idx" ON "LeadCmr"("companyId", "jesseInputNeeded");

-- CreateIndex
CREATE INDEX "LeadCall_leadId_at_idx" ON "LeadCall"("leadId", "at");

-- CreateIndex
CREATE INDEX "LeadCall_businessId_userId_at_idx" ON "LeadCall"("businessId", "userId", "at");

-- CreateIndex
CREATE INDEX "LeadCall_companyId_idx" ON "LeadCall"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCall_businessId_externalId_key" ON "LeadCall"("businessId", "externalId");

-- CreateIndex
CREATE INDEX "LeadComment_leadId_createdAt_idx" ON "LeadComment"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadComment_companyId_idx" ON "LeadComment"("companyId");

-- CreateIndex
CREATE INDEX "LeadTask_businessId_assigneeId_doneAt_dueAt_idx" ON "LeadTask"("businessId", "assigneeId", "doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "LeadTask_leadId_idx" ON "LeadTask"("leadId");

-- CreateIndex
CREATE INDEX "LeadTask_companyId_idx" ON "LeadTask"("companyId");

-- CreateIndex
CREATE INDEX "LeadListEntry_businessId_kind_nameKey_idx" ON "LeadListEntry"("businessId", "kind", "nameKey");

-- CreateIndex
CREATE INDEX "LeadListEntry_companyId_idx" ON "LeadListEntry"("companyId");

-- CreateIndex
CREATE INDEX "LeadDailyReport_companyId_date_idx" ON "LeadDailyReport"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDailyReport_businessId_userId_date_key" ON "LeadDailyReport"("businessId", "userId", "date");

-- CreateIndex
CREATE INDEX "Lead_businessId_orgKey_idx" ON "Lead"("businessId", "orgKey");

-- CreateIndex
CREATE INDEX "Lead_businessId_phoneE164_idx" ON "Lead"("businessId", "phoneE164");

-- CreateIndex
CREATE INDEX "Lead_businessId_nextStepDate_idx" ON "Lead"("businessId", "nextStepDate");

-- AddForeignKey
ALTER TABLE "LeadBusiness" ADD CONSTRAINT "LeadBusiness_headId_fkey" FOREIGN KEY ("headId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCmr" ADD CONSTRAINT "LeadCmr_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCmr" ADD CONSTRAINT "LeadCmr_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LeadBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadComment" ADD CONSTRAINT "LeadComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadComment" ADD CONSTRAINT "LeadComment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadComment" ADD CONSTRAINT "LeadComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LeadBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListEntry" ADD CONSTRAINT "LeadListEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListEntry" ADD CONSTRAINT "LeadListEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LeadBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDailyReport" ADD CONSTRAINT "LeadDailyReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDailyReport" ADD CONSTRAINT "LeadDailyReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LeadBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDailyReport" ADD CONSTRAINT "LeadDailyReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Company walls for the new tables (generated by src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_LeadCmr"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadCmr row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadCmr.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadCmr_company_wall" ON "LeadCmr";
CREATE TRIGGER "LeadCmr_company_wall" BEFORE INSERT OR UPDATE ON "LeadCmr" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadCmr"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadCall"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadCall row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."businessId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId"; END IF;
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."businessId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."businessId" IS DISTINCT FROM OLD."businessId") THEN
    SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadCall.businessId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadCall.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadCall.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadCall_company_wall" ON "LeadCall";
CREATE TRIGGER "LeadCall_company_wall" BEFORE INSERT OR UPDATE ON "LeadCall" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadCall"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadComment"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadComment row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadComment.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadComment.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadComment_company_wall" ON "LeadComment";
CREATE TRIGGER "LeadComment_company_wall" BEFORE INSERT OR UPDATE ON "LeadComment" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadComment"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadTask"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadTask row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."businessId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId"; END IF;
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId"; END IF;
    IF c IS NULL AND NEW."assigneeId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."assigneeId"; END IF;
    IF c IS NULL AND NEW."doneById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."doneById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."businessId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."businessId" IS DISTINCT FROM OLD."businessId") THEN
    SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadTask.businessId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadTask.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."assigneeId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."assigneeId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadTask.assigneeId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."doneById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."doneById" IS DISTINCT FROM OLD."doneById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."doneById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadTask.doneById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadTask_company_wall" ON "LeadTask";
CREATE TRIGGER "LeadTask_company_wall" BEFORE INSERT OR UPDATE ON "LeadTask" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadTask"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadListEntry"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadListEntry row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."businessId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."businessId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."businessId" IS DISTINCT FROM OLD."businessId") THEN
    SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadListEntry.businessId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadListEntry_company_wall" ON "LeadListEntry";
CREATE TRIGGER "LeadListEntry_company_wall" BEFORE INSERT OR UPDATE ON "LeadListEntry" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadListEntry"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadDailyReport"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadDailyReport row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."businessId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."businessId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."businessId" IS DISTINCT FROM OLD."businessId") THEN
    SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadDailyReport.businessId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadDailyReport.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadDailyReport_company_wall" ON "LeadDailyReport";
CREATE TRIGGER "LeadDailyReport_company_wall" BEFORE INSERT OR UPDATE ON "LeadDailyReport" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadDailyReport"();

-- The CMR flow starts switched off for 99 Technologies: nothing changes for them until the owner turns it on (owner console, Switches).
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
VALUES ('cmr', 'company-1', false, CURRENT_TIMESTAMP, 'CMR setup')
ON CONFLICT ("key", "companyId") DO NOTHING;

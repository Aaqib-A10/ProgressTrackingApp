-- Lead Management: businesses that receive leads, their managers and reps, the leads and each lead's timeline.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'LEAD_NEW';
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_SLA';

-- CreateTable
CREATE TABLE "LeadBusiness" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "website" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "formKey" TEXT NOT NULL,
    "slaAssignMins" INTEGER NOT NULL DEFAULT 15,
    "slaContactMins" INTEGER NOT NULL DEFAULT 120,
    "inboxOn" BOOLEAN NOT NULL DEFAULT false,
    "inboxHost" TEXT,
    "inboxPort" INTEGER NOT NULL DEFAULT 993,
    "inboxSecure" BOOLEAN NOT NULL DEFAULT true,
    "inboxUser" TEXT,
    "inboxPassEnc" TEXT,
    "inboxFolder" TEXT NOT NULL DEFAULT 'INBOX',
    "inboxLastUid" INTEGER NOT NULL DEFAULT 0,
    "inboxCheckedAt" TIMESTAMP(3),
    "inboxError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadBusinessMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'REP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadBusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "organization" TEXT,
    "message" TEXT,
    "location" TEXT,
    "source" TEXT NOT NULL DEFAULT 'PHONE',
    "sourceDetail" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "gclid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "value" DOUBLE PRECISION,
    "assigneeId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignedById" TEXT,
    "firstContactAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repeats" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "raw" JSONB,
    "slaAssignAlertAt" TIMESTAMP(3),
    "slaContactAlertAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadBusiness_formKey_key" ON "LeadBusiness"("formKey");

-- CreateIndex
CREATE INDEX "LeadBusiness_companyId_idx" ON "LeadBusiness"("companyId");

-- CreateIndex
CREATE INDEX "LeadBusinessMember_userId_idx" ON "LeadBusinessMember"("userId");

-- CreateIndex
CREATE INDEX "LeadBusinessMember_companyId_idx" ON "LeadBusinessMember"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadBusinessMember_businessId_userId_key" ON "LeadBusinessMember"("businessId", "userId");

-- CreateIndex
CREATE INDEX "Lead_businessId_status_idx" ON "Lead"("businessId", "status");

-- CreateIndex
CREATE INDEX "Lead_assigneeId_status_idx" ON "Lead"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Lead_businessId_email_idx" ON "Lead"("businessId", "email");

-- CreateIndex
CREATE INDEX "Lead_businessId_phone_idx" ON "Lead"("businessId", "phone");

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_businessId_externalId_key" ON "Lead"("businessId", "externalId");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_createdAt_idx" ON "LeadEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_companyId_idx" ON "LeadEvent"("companyId");

-- AddForeignKey
ALTER TABLE "LeadBusiness" ADD CONSTRAINT "LeadBusiness_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadBusinessMember" ADD CONSTRAINT "LeadBusinessMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadBusinessMember" ADD CONSTRAINT "LeadBusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LeadBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadBusinessMember" ADD CONSTRAINT "LeadBusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LeadBusiness"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Company walls for the new tables (generated by src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_LeadBusiness"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadBusiness row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadBusiness_company_wall" ON "LeadBusiness";
CREATE TRIGGER "LeadBusiness_company_wall" BEFORE INSERT OR UPDATE ON "LeadBusiness" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadBusiness"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadBusinessMember"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadBusinessMember row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."businessId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."businessId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."businessId" IS DISTINCT FROM OLD."businessId") THEN
    SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadBusinessMember.businessId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadBusinessMember.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadBusinessMember_company_wall" ON "LeadBusinessMember";
CREATE TRIGGER "LeadBusinessMember_company_wall" BEFORE INSERT OR UPDATE ON "LeadBusinessMember" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadBusinessMember"();

CREATE OR REPLACE FUNCTION "mq_wall_Lead"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a Lead row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."businessId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId"; END IF;
    IF c IS NULL AND NEW."assigneeId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."assigneeId"; END IF;
    IF c IS NULL AND NEW."assignedById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."assignedById"; END IF;
    IF c IS NULL AND NEW."createdById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."businessId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."businessId" IS DISTINCT FROM OLD."businessId") THEN
    SELECT "companyId" INTO c FROM "LeadBusiness" WHERE "id" = NEW."businessId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: Lead.businessId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."assigneeId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."assigneeId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: Lead.assigneeId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."assignedById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."assignedById" IS DISTINCT FROM OLD."assignedById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."assignedById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: Lead.assignedById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."createdById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: Lead.createdById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "Lead_company_wall" ON "Lead";
CREATE TRIGGER "Lead_company_wall" BEFORE INSERT OR UPDATE ON "Lead" FOR EACH ROW EXECUTE FUNCTION "mq_wall_Lead"();

CREATE OR REPLACE FUNCTION "mq_wall_LeadEvent"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeadEvent row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."leadId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."leadId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."leadId" IS DISTINCT FROM OLD."leadId") THEN
    SELECT "companyId" INTO c FROM "Lead" WHERE "id" = NEW."leadId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadEvent.leadId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeadEvent.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeadEvent_company_wall" ON "LeadEvent";
CREATE TRIGGER "LeadEvent_company_wall" BEFORE INSERT OR UPDATE ON "LeadEvent" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeadEvent"();

-- Lead Management starts switched off for 99 Technologies: nothing changes for them until the owner turns it on (owner console, Switches).
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
VALUES ('lead-management', 'company-1', false, CURRENT_TIMESTAMP, 'Lead Management setup')
ON CONFLICT ("key", "companyId") DO NOTHING;

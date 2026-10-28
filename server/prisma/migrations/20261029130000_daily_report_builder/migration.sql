-- Phase 1, step 5: the Daily Report builder (a company's own daily form).

-- CreateEnum
CREATE TYPE "ReportFieldType" AS ENUM ('NUMBER', 'TEXT', 'LONG_TEXT', 'CHOICE', 'MULTI_CHOICE', 'YES_NO', 'RATING', 'LINK');

-- CreateTable
CREATE TABLE "ReportForm" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportField" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "formId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "help" TEXT,
    "type" "ReportFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "target" DOUBLE PRECISION,
    "targetDir" TEXT NOT NULL DEFAULT 'MIN',
    "unit" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "formId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "values" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportForm_companyId_idx" ON "ReportForm"("companyId");

-- CreateIndex
CREATE INDEX "ReportForm_departmentId_idx" ON "ReportForm"("departmentId");

-- CreateIndex
CREATE INDEX "ReportField_formId_position_idx" ON "ReportField"("formId", "position");

-- CreateIndex
CREATE INDEX "ReportField_companyId_idx" ON "ReportField"("companyId");

-- CreateIndex
CREATE INDEX "ReportEntry_formId_date_idx" ON "ReportEntry"("formId", "date");

-- CreateIndex
CREATE INDEX "ReportEntry_companyId_idx" ON "ReportEntry"("companyId");

-- CreateIndex
CREATE INDEX "ReportEntry_userId_date_idx" ON "ReportEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReportEntry_formId_userId_date_key" ON "ReportEntry"("formId", "userId", "date");

-- AddForeignKey
ALTER TABLE "ReportForm" ADD CONSTRAINT "ReportForm_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportForm" ADD CONSTRAINT "ReportForm_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportForm" ADD CONSTRAINT "ReportForm_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportField" ADD CONSTRAINT "ReportField_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportField" ADD CONSTRAINT "ReportField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ReportForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEntry" ADD CONSTRAINT "ReportEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEntry" ADD CONSTRAINT "ReportEntry_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ReportForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEntry" ADD CONSTRAINT "ReportEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Company walls for the new tables.
CREATE OR REPLACE FUNCTION "mq_wall_ReportForm"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a ReportForm row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."departmentId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Department" WHERE "id" = NEW."departmentId"; END IF;
    IF c IS NULL AND NEW."createdById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."departmentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId") THEN
    SELECT "companyId" INTO c FROM "Department" WHERE "id" = NEW."departmentId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ReportForm.departmentId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."createdById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ReportForm.createdById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ReportForm_company_wall" ON "ReportForm";
CREATE TRIGGER "ReportForm_company_wall" BEFORE INSERT OR UPDATE ON "ReportForm" FOR EACH ROW EXECUTE FUNCTION "mq_wall_ReportForm"();

CREATE OR REPLACE FUNCTION "mq_wall_ReportField"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a ReportField row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."formId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "ReportForm" WHERE "id" = NEW."formId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."formId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."formId" IS DISTINCT FROM OLD."formId") THEN
    SELECT "companyId" INTO c FROM "ReportForm" WHERE "id" = NEW."formId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ReportField.formId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ReportField_company_wall" ON "ReportField";
CREATE TRIGGER "ReportField_company_wall" BEFORE INSERT OR UPDATE ON "ReportField" FOR EACH ROW EXECUTE FUNCTION "mq_wall_ReportField"();

CREATE OR REPLACE FUNCTION "mq_wall_ReportEntry"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a ReportEntry row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."formId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "ReportForm" WHERE "id" = NEW."formId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."formId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."formId" IS DISTINCT FROM OLD."formId") THEN
    SELECT "companyId" INTO c FROM "ReportForm" WHERE "id" = NEW."formId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ReportEntry.formId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ReportEntry.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ReportEntry_company_wall" ON "ReportEntry";
CREATE TRIGGER "ReportEntry_company_wall" BEFORE INSERT OR UPDATE ON "ReportEntry" FOR EACH ROW EXECUTE FUNCTION "mq_wall_ReportEntry"();


-- The Daily Report starts switched off for 99 Technologies: their six daily logs stay as they
-- are until both have run side by side for a week (owner console, Switches).
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
VALUES ('daily-report', 'company-1', false, CURRENT_TIMESTAMP, 'Phase 1 setup')
ON CONFLICT ("key", "companyId") DO NOTHING;

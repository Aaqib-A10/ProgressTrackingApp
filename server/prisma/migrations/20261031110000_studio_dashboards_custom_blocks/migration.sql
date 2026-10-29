-- Department Studio, parts B and C: dashboards made of cards for each department and role (and how
-- each person arranged their own), and blocks a company makes itself (forms, tables, boards, calendars).

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "dashboard" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dashboardPrefs" JSONB;

-- CreateTable
CREATE TABLE "CustomBlock" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'LayoutGrid',
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "fields" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "blockId" TEXT NOT NULL,
    "departmentId" TEXT,
    "createdById" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomBlock_companyId_idx" ON "CustomBlock"("companyId");

-- CreateIndex
CREATE INDEX "CustomRecord_blockId_departmentId_idx" ON "CustomRecord"("blockId", "departmentId");

-- CreateIndex
CREATE INDEX "CustomRecord_companyId_idx" ON "CustomRecord"("companyId");

-- AddForeignKey
ALTER TABLE "CustomBlock" ADD CONSTRAINT "CustomBlock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomBlock" ADD CONSTRAINT "CustomBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "CustomBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRecord" ADD CONSTRAINT "CustomRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Company walls for the new tables.
CREATE OR REPLACE FUNCTION "mq_wall_CustomBlock"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a CustomBlock row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."createdById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."createdById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: CustomBlock.createdById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "CustomBlock_company_wall" ON "CustomBlock";
CREATE TRIGGER "CustomBlock_company_wall" BEFORE INSERT OR UPDATE ON "CustomBlock" FOR EACH ROW EXECUTE FUNCTION "mq_wall_CustomBlock"();

CREATE OR REPLACE FUNCTION "mq_wall_CustomRecord"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a CustomRecord row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."blockId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "CustomBlock" WHERE "id" = NEW."blockId"; END IF;
    IF c IS NULL AND NEW."departmentId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Department" WHERE "id" = NEW."departmentId"; END IF;
    IF c IS NULL AND NEW."createdById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."blockId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."blockId" IS DISTINCT FROM OLD."blockId") THEN
    SELECT "companyId" INTO c FROM "CustomBlock" WHERE "id" = NEW."blockId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: CustomRecord.blockId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."departmentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId") THEN
    SELECT "companyId" INTO c FROM "Department" WHERE "id" = NEW."departmentId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: CustomRecord.departmentId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."createdById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: CustomRecord.createdById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "CustomRecord_company_wall" ON "CustomRecord";
CREATE TRIGGER "CustomRecord_company_wall" BEFORE INSERT OR UPDATE ON "CustomRecord" FOR EACH ROW EXECUTE FUNCTION "mq_wall_CustomRecord"();


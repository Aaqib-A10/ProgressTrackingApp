-- Phase 1, step 4: departments, roles and powers become each company's own data.
-- A company can make General departments, its own roles (on top of the built-in ones) and
-- give extra powers (such as finance) to a role or a person.

-- AlterEnum
ALTER TYPE "DepartmentType" ADD VALUE 'GENERAL';

-- DropIndex
DROP INDEX "Department_companyId_type_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customRoleId" TEXT,
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CompanyRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "baseRole" "Role" NOT NULL,
    "areasOff" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "powers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyRole_companyId_idx" ON "CompanyRole"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRole_companyId_name_key" ON "CompanyRole"("companyId", "name");

-- CreateIndex
CREATE INDEX "Department_companyId_type_idx" ON "Department"("companyId", "type");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CompanyRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRole" ADD CONSTRAINT "CompanyRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Company walls for the new table and the new link from User.
CREATE OR REPLACE FUNCTION "mq_wall_User"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a User row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."customRoleId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "CompanyRole" WHERE "id" = NEW."customRoleId"; END IF;
    IF c IS NULL AND NEW."departmentId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "Department" WHERE "id" = NEW."departmentId"; END IF;
    IF c IS NULL AND NEW."subDepartmentId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "SubDepartment" WHERE "id" = NEW."subDepartmentId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."customRoleId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."customRoleId" IS DISTINCT FROM OLD."customRoleId") THEN
    SELECT "companyId" INTO c FROM "CompanyRole" WHERE "id" = NEW."customRoleId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: User.customRoleId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."departmentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId") THEN
    SELECT "companyId" INTO c FROM "Department" WHERE "id" = NEW."departmentId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: User.departmentId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."subDepartmentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."subDepartmentId" IS DISTINCT FROM OLD."subDepartmentId") THEN
    SELECT "companyId" INTO c FROM "SubDepartment" WHERE "id" = NEW."subDepartmentId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: User.subDepartmentId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "User_company_wall" ON "User";
CREATE TRIGGER "User_company_wall" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION "mq_wall_User"();

CREATE OR REPLACE FUNCTION "mq_wall_CompanyRole"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a CompanyRole row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "CompanyRole_company_wall" ON "CompanyRole";
CREATE TRIGGER "CompanyRole_company_wall" BEFORE INSERT OR UPDATE ON "CompanyRole" FOR EACH ROW EXECUTE FUNCTION "mq_wall_CompanyRole"();


-- The Company settings page starts switched off for 99 Technologies (owner console, Switches),
-- so nothing changes for them until the owner turns it on.
INSERT INTO "FeatureFlagCompany" ("key", "companyId", "enabled", "updatedAt", "updatedBy")
VALUES ('company-settings', 'company-1', false, CURRENT_TIMESTAMP, 'Phase 1 setup')
ON CONFLICT ("key", "companyId") DO NOTHING;

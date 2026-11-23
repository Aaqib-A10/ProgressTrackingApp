-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'APPROVAL_DECIDED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "whatsappNumber" TEXT,
ADD COLUMN     "whatsappOn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "leaveAllowances" JSONB;

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "minAmount" DECIMAL(14,2),
    "chain" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "days" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leaveKind" TEXT,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "requestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "approver" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "decidedById" TEXT,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT,
    "jobTitle" TEXT,
    "employmentType" TEXT,
    "joinedOn" DATE,
    "leftOn" DATE,
    "birthday" DATE,
    "phone" TEXT,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "managerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAllowance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LeaveAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDoc" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerAddress" TEXT,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidNote" TEXT,
    "fromDocId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "docId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SalesDocLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmRecurrence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "every" TEXT NOT NULL,
    "onDay" INTEGER,
    "dueInDays" INTEGER NOT NULL DEFAULT 1,
    "nextOn" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastMadeAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmTaskDependency" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL,
    "blockedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmTaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmTimeEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRule_companyId_kind_idx" ON "ApprovalRule"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_number_key" ON "ApprovalRequest"("number");

-- CreateIndex
CREATE INDEX "ApprovalRequest_companyId_status_idx" ON "ApprovalRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requesterId_idx" ON "ApprovalRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ApprovalStep_companyId_idx" ON "ApprovalStep"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_requestId_position_key" ON "ApprovalStep"("requestId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PersonRecord_userId_key" ON "PersonRecord"("userId");

-- CreateIndex
CREATE INDEX "PersonRecord_companyId_idx" ON "PersonRecord"("companyId");

-- CreateIndex
CREATE INDEX "LeaveAllowance_companyId_idx" ON "LeaveAllowance"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAllowance_userId_year_kind_key" ON "LeaveAllowance"("userId", "year", "kind");

-- CreateIndex
CREATE INDEX "SalesDoc_companyId_kind_status_idx" ON "SalesDoc"("companyId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDoc_companyId_kind_number_key" ON "SalesDoc"("companyId", "kind", "number");

-- CreateIndex
CREATE INDEX "SalesDocLine_docId_idx" ON "SalesDocLine"("docId");

-- CreateIndex
CREATE INDEX "SalesDocLine_companyId_idx" ON "SalesDocLine"("companyId");

-- CreateIndex
CREATE INDEX "SavedReport_companyId_idx" ON "SavedReport"("companyId");

-- CreateIndex
CREATE INDEX "PmRecurrence_companyId_idx" ON "PmRecurrence"("companyId");

-- CreateIndex
CREATE INDEX "PmRecurrence_nextOn_active_idx" ON "PmRecurrence"("nextOn", "active");

-- CreateIndex
CREATE INDEX "PmTaskDependency_companyId_idx" ON "PmTaskDependency"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PmTaskDependency_taskId_blockedById_key" ON "PmTaskDependency"("taskId", "blockedById");

-- CreateIndex
CREATE INDEX "PmTimeEntry_taskId_idx" ON "PmTimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "PmTimeEntry_userId_endedAt_idx" ON "PmTimeEntry"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "PmTimeEntry_companyId_idx" ON "PmTimeEntry"("companyId");

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRecord" ADD CONSTRAINT "PersonRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRecord" ADD CONSTRAINT "PersonRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRecord" ADD CONSTRAINT "PersonRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAllowance" ADD CONSTRAINT "LeaveAllowance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAllowance" ADD CONSTRAINT "LeaveAllowance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDoc" ADD CONSTRAINT "SalesDoc_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDoc" ADD CONSTRAINT "SalesDoc_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocLine" ADD CONSTRAINT "SalesDocLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocLine" ADD CONSTRAINT "SalesDocLine_docId_fkey" FOREIGN KEY ("docId") REFERENCES "SalesDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmRecurrence" ADD CONSTRAINT "PmRecurrence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmRecurrence" ADD CONSTRAINT "PmRecurrence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PmProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskDependency" ADD CONSTRAINT "PmTaskDependency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskDependency" ADD CONSTRAINT "PmTaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTaskDependency" ADD CONSTRAINT "PmTaskDependency_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTimeEntry" ADD CONSTRAINT "PmTimeEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTimeEntry" ADD CONSTRAINT "PmTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmTimeEntry" ADD CONSTRAINT "PmTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The company wall on each new table (src/scripts/companyWallsSql.ts).
CREATE OR REPLACE FUNCTION "mq_wall_ApprovalRule"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a ApprovalRule row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ApprovalRule_company_wall" ON "ApprovalRule";
CREATE TRIGGER "ApprovalRule_company_wall" BEFORE INSERT OR UPDATE ON "ApprovalRule" FOR EACH ROW EXECUTE FUNCTION "mq_wall_ApprovalRule"();

CREATE OR REPLACE FUNCTION "mq_wall_ApprovalRequest"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a ApprovalRequest row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."requesterId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."requesterId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."requesterId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."requesterId" IS DISTINCT FROM OLD."requesterId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."requesterId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ApprovalRequest.requesterId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ApprovalRequest_company_wall" ON "ApprovalRequest";
CREATE TRIGGER "ApprovalRequest_company_wall" BEFORE INSERT OR UPDATE ON "ApprovalRequest" FOR EACH ROW EXECUTE FUNCTION "mq_wall_ApprovalRequest"();

CREATE OR REPLACE FUNCTION "mq_wall_ApprovalStep"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a ApprovalStep row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."requestId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "ApprovalRequest" WHERE "id" = NEW."requestId"; END IF;
    IF c IS NULL AND NEW."decidedById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."decidedById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."requestId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."requestId" IS DISTINCT FROM OLD."requestId") THEN
    SELECT "companyId" INTO c FROM "ApprovalRequest" WHERE "id" = NEW."requestId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ApprovalStep.requestId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."decidedById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."decidedById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: ApprovalStep.decidedById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ApprovalStep_company_wall" ON "ApprovalStep";
CREATE TRIGGER "ApprovalStep_company_wall" BEFORE INSERT OR UPDATE ON "ApprovalStep" FOR EACH ROW EXECUTE FUNCTION "mq_wall_ApprovalStep"();

CREATE OR REPLACE FUNCTION "mq_wall_PersonRecord"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a PersonRecord row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    IF c IS NULL AND NEW."managerId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."managerId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PersonRecord.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."managerId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."managerId" IS DISTINCT FROM OLD."managerId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."managerId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PersonRecord.managerId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PersonRecord_company_wall" ON "PersonRecord";
CREATE TRIGGER "PersonRecord_company_wall" BEFORE INSERT OR UPDATE ON "PersonRecord" FOR EACH ROW EXECUTE FUNCTION "mq_wall_PersonRecord"();

CREATE OR REPLACE FUNCTION "mq_wall_LeaveAllowance"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a LeaveAllowance row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: LeaveAllowance.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LeaveAllowance_company_wall" ON "LeaveAllowance";
CREATE TRIGGER "LeaveAllowance_company_wall" BEFORE INSERT OR UPDATE ON "LeaveAllowance" FOR EACH ROW EXECUTE FUNCTION "mq_wall_LeaveAllowance"();

CREATE OR REPLACE FUNCTION "mq_wall_SalesDoc"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a SalesDoc row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."createdById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."createdById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."createdById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: SalesDoc.createdById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SalesDoc_company_wall" ON "SalesDoc";
CREATE TRIGGER "SalesDoc_company_wall" BEFORE INSERT OR UPDATE ON "SalesDoc" FOR EACH ROW EXECUTE FUNCTION "mq_wall_SalesDoc"();

CREATE OR REPLACE FUNCTION "mq_wall_SalesDocLine"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a SalesDocLine row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."docId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "SalesDoc" WHERE "id" = NEW."docId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."docId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."docId" IS DISTINCT FROM OLD."docId") THEN
    SELECT "companyId" INTO c FROM "SalesDoc" WHERE "id" = NEW."docId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: SalesDocLine.docId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SalesDocLine_company_wall" ON "SalesDocLine";
CREATE TRIGGER "SalesDocLine_company_wall" BEFORE INSERT OR UPDATE ON "SalesDocLine" FOR EACH ROW EXECUTE FUNCTION "mq_wall_SalesDocLine"();

CREATE OR REPLACE FUNCTION "mq_wall_SavedReport"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a SavedReport row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."ownerId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."ownerId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."ownerId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."ownerId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: SavedReport.ownerId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SavedReport_company_wall" ON "SavedReport";
CREATE TRIGGER "SavedReport_company_wall" BEFORE INSERT OR UPDATE ON "SavedReport" FOR EACH ROW EXECUTE FUNCTION "mq_wall_SavedReport"();

CREATE OR REPLACE FUNCTION "mq_wall_PmRecurrence"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a PmRecurrence row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."projectId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "PmProject" WHERE "id" = NEW."projectId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."projectId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."projectId" IS DISTINCT FROM OLD."projectId") THEN
    SELECT "companyId" INTO c FROM "PmProject" WHERE "id" = NEW."projectId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PmRecurrence.projectId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PmRecurrence_company_wall" ON "PmRecurrence";
CREATE TRIGGER "PmRecurrence_company_wall" BEFORE INSERT OR UPDATE ON "PmRecurrence" FOR EACH ROW EXECUTE FUNCTION "mq_wall_PmRecurrence"();

CREATE OR REPLACE FUNCTION "mq_wall_PmTaskDependency"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a PmTaskDependency row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."taskId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "PmTask" WHERE "id" = NEW."taskId"; END IF;
    IF c IS NULL AND NEW."blockedById" IS NOT NULL THEN SELECT "companyId" INTO c FROM "PmTask" WHERE "id" = NEW."blockedById"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."taskId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."taskId" IS DISTINCT FROM OLD."taskId") THEN
    SELECT "companyId" INTO c FROM "PmTask" WHERE "id" = NEW."taskId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PmTaskDependency.taskId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."blockedById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."blockedById" IS DISTINCT FROM OLD."blockedById") THEN
    SELECT "companyId" INTO c FROM "PmTask" WHERE "id" = NEW."blockedById";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PmTaskDependency.blockedById points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PmTaskDependency_company_wall" ON "PmTaskDependency";
CREATE TRIGGER "PmTaskDependency_company_wall" BEFORE INSERT OR UPDATE ON "PmTaskDependency" FOR EACH ROW EXECUTE FUNCTION "mq_wall_PmTaskDependency"();

CREATE OR REPLACE FUNCTION "mq_wall_PmTimeEntry"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a PmTimeEntry row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    IF c IS NULL AND NEW."taskId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "PmTask" WHERE "id" = NEW."taskId"; END IF;
    IF c IS NULL AND NEW."userId" IS NOT NULL THEN SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId"; END IF;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;
  IF NEW."taskId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."taskId" IS DISTINCT FROM OLD."taskId") THEN
    SELECT "companyId" INTO c FROM "PmTask" WHERE "id" = NEW."taskId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PmTimeEntry.taskId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  IF NEW."userId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    SELECT "companyId" INTO c FROM "User" WHERE "id" = NEW."userId";
    IF c IS NOT NULL AND c <> NEW."companyId" THEN RAISE EXCEPTION 'metriq company wall: PmTimeEntry.userId points at another company' USING ERRCODE = 'P0420'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "PmTimeEntry_company_wall" ON "PmTimeEntry";
CREATE TRIGGER "PmTimeEntry_company_wall" BEFORE INSERT OR UPDATE ON "PmTimeEntry" FOR EACH ROW EXECUTE FUNCTION "mq_wall_PmTimeEntry"();

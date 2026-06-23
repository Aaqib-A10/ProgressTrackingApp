-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MEMBER', 'TEAM_LEAD', 'SUB_DEPT_LEAD', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "DepartmentType" AS ENUM ('ITAD', 'LEAD_GEN', 'MARKETING');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('SUBMITTED', 'ON_LEAVE', 'HOLIDAY', 'OFF');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('VERTICAL', 'PLATFORM', 'CAMPAIGN', 'DATA_SOURCE');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TargetScope" AS ENUM ('DEPARTMENT', 'SUB_DEPARTMENT', 'USER');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ON_LEAVE', 'HOLIDAY', 'OFF');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "type" "DepartmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubDepartment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "departmentId" TEXT,
    "subDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItadDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "callsDialed" INTEGER NOT NULL DEFAULT 0,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "voicemail" INTEGER NOT NULL DEFAULT 0,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "interested" INTEGER NOT NULL DEFAULT 0,
    "workingOn" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "rfqs" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItadDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadGenDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "leadsGenerated" INTEGER NOT NULL DEFAULT 0,
    "accountsResearched" INTEGER NOT NULL DEFAULT 0,
    "contactsFound" INTEGER NOT NULL DEFAULT 0,
    "qualifiedMql" INTEGER NOT NULL DEFAULT 0,
    "handedToSql" INTEGER NOT NULL DEFAULT 0,
    "dataSource" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadGenDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadGenVerticalCount" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadGenVerticalCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TagType" NOT NULL,
    "departmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "scope" "TargetScope" NOT NULL,
    "metricKey" TEXT NOT NULL,
    "period" "TargetPeriod" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "departmentId" TEXT,
    "subDepartmentId" TEXT,
    "userId" TEXT,
    "setById" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "LeaveType" NOT NULL DEFAULT 'ON_LEAVE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_type_key" ON "Department"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SubDepartment_departmentId_slug_key" ON "SubDepartment"("departmentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_subDepartmentId_idx" ON "User"("subDepartmentId");

-- CreateIndex
CREATE INDEX "ItadDailyEntry_date_idx" ON "ItadDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ItadDailyEntry_userId_date_key" ON "ItadDailyEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "LeadGenDailyEntry_date_idx" ON "LeadGenDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LeadGenDailyEntry_userId_date_key" ON "LeadGenDailyEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeadGenVerticalCount_entryId_tagId_key" ON "LeadGenVerticalCount"("entryId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_departmentId_type_name_key" ON "Tag"("departmentId", "type", "name");

-- CreateIndex
CREATE INDEX "Target_departmentId_metricKey_idx" ON "Target"("departmentId", "metricKey");

-- CreateIndex
CREATE INDEX "Target_userId_metricKey_idx" ON "Target"("userId", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "LeaveDay_date_idx" ON "LeaveDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveDay_userId_date_key" ON "LeaveDay"("userId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "SubDepartment" ADD CONSTRAINT "SubDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_subDepartmentId_fkey" FOREIGN KEY ("subDepartmentId") REFERENCES "SubDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItadDailyEntry" ADD CONSTRAINT "ItadDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenDailyEntry" ADD CONSTRAINT "LeadGenDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenVerticalCount" ADD CONSTRAINT "LeadGenVerticalCount_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LeadGenDailyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadGenVerticalCount" ADD CONSTRAINT "LeadGenVerticalCount_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_subDepartmentId_fkey" FOREIGN KEY ("subDepartmentId") REFERENCES "SubDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

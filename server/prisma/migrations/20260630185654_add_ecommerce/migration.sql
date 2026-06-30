-- CreateEnum
CREATE TYPE "EcomTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "StockAction" AS ENUM ('STOCK_IN', 'STOCK_OUT');

-- AlterEnum
ALTER TYPE "DepartmentType" ADD VALUE 'ECOMMERCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TagType" ADD VALUE 'MARKETPLACE';
ALTER TYPE "TagType" ADD VALUE 'TASK_TYPE';

-- CreateTable
CREATE TABLE "EcommerceDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcommerceDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcommerceListingLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "listings" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EcommerceListingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcommerceTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "status" "EcomTaskStatus" NOT NULL DEFAULT 'TODO',
    "order" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "createdById" TEXT,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcommerceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StockStatus" NOT NULL DEFAULT 'REQUESTED',
    "action" "StockAction",
    "assignedToId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcommerceDailyEntry_date_idx" ON "EcommerceDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "EcommerceDailyEntry_userId_date_key" ON "EcommerceDailyEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "EcommerceListingLine_entryId_idx" ON "EcommerceListingLine"("entryId");

-- CreateIndex
CREATE INDEX "EcommerceTask_status_idx" ON "EcommerceTask"("status");

-- CreateIndex
CREATE INDEX "EcommerceTask_assignedToId_idx" ON "EcommerceTask"("assignedToId");

-- CreateIndex
CREATE INDEX "StockRequest_departmentId_status_idx" ON "StockRequest"("departmentId", "status");

-- AddForeignKey
ALTER TABLE "EcommerceDailyEntry" ADD CONSTRAINT "EcommerceDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceListingLine" ADD CONSTRAINT "EcommerceListingLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "EcommerceDailyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceListingLine" ADD CONSTRAINT "EcommerceListingLine_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceListingLine" ADD CONSTRAINT "EcommerceListingLine_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceTask" ADD CONSTRAINT "EcommerceTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceTask" ADD CONSTRAINT "EcommerceTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

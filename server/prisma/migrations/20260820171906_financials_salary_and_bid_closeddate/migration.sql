-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "closedDate" TIMESTAMP(3);

-- Backfill closedDate for already-decided deals so historical revenue lands in the right period.
UPDATE "Bid" SET "closedDate" = "updatedAt" WHERE "status" IN ('WON', 'LOST') AND "closedDate" IS NULL;

-- CreateTable
CREATE TABLE "SalaryRecord" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT NOT NULL,
    "monthlyCost" DECIMAL(12,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "note" TEXT,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryRecord_departmentId_idx" ON "SalaryRecord"("departmentId");

-- CreateIndex
CREATE INDEX "SalaryRecord_userId_idx" ON "SalaryRecord"("userId");

-- CreateIndex
CREATE INDEX "Bid_status_closedDate_idx" ON "Bid"("status", "closedDate");

-- AddForeignKey
ALTER TABLE "SalaryRecord" ADD CONSTRAINT "SalaryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRecord" ADD CONSTRAINT "SalaryRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRecord" ADD CONSTRAINT "SalaryRecord_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

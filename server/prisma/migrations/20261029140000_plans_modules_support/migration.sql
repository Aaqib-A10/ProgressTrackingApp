-- Phase 1, step 6: plans, modules per company, usage, and help sign-in with the company's consent.
-- 99 Technologies stays on the internal plan (no limits, everything on). New companies start on Starter.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "modulesOff" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "modulesOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supportAccessById" TEXT,
ADD COLUMN     "supportAccessUntil" TIMESTAMP(3),
ALTER COLUMN "plan" SET DEFAULT 'starter';

-- CreateTable
CREATE TABLE "CompanyUsage" (
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "aiSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyUsage_pkey" PRIMARY KEY ("companyId","month")
);

-- AddForeignKey
ALTER TABLE "CompanyUsage" ADD CONSTRAINT "CompanyUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


UPDATE "Company" SET "plan" = 'internal' WHERE "id" = 'company-1';

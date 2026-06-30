-- CreateEnum
CREATE TYPE "BreakdownKind" AS ENUM ('CAMPAIGN', 'INDUSTRY');

-- CreateTable
CREATE TABLE "LeadGenBreakdown" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" "BreakdownKind" NOT NULL DEFAULT 'INDUSTRY',
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadGenBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadGenBreakdown_month_idx" ON "LeadGenBreakdown"("month");

-- CreateIndex
CREATE UNIQUE INDEX "LeadGenBreakdown_month_category_key" ON "LeadGenBreakdown"("month", "category");

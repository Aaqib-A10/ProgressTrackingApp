-- CreateEnum
CREATE TYPE "BidType" AS ENUM ('RFQ', 'RFP', 'BID');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('ACTIVE', 'SUBMITTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "BidSubmissionType" AS ENUM ('PHYSICAL', 'EMAIL', 'PORTAL');

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "type" "BidType" NOT NULL,
    "district" TEXT,
    "agentId" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" "BidStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "reminderSet" BOOLEAN NOT NULL DEFAULT false,
    "submissionType" "BidSubmissionType",
    "priceQuoted" DOUBLE PRECISION,
    "awardedPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bid_number_key" ON "Bid"("number");

-- CreateIndex
CREATE INDEX "Bid_departmentId_status_idx" ON "Bid"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Bid_agentId_idx" ON "Bid"("agentId");

-- CreateIndex
CREATE INDEX "Bid_dueDate_idx" ON "Bid"("dueDate");

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "WfhRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum


ALTER TYPE "NotificationType" ADD VALUE 'WFH_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'WFH_DECIDED';

-- CreateTable
CREATE TABLE "WfhRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" TEXT[],
    "reason" TEXT NOT NULL,
    "status" "WfhRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WfhRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WfhRequest_userId_status_idx" ON "WfhRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "WfhRequest_status_createdAt_idx" ON "WfhRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "WfhRequest" ADD CONSTRAINT "WfhRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WfhRequest" ADD CONSTRAINT "WfhRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


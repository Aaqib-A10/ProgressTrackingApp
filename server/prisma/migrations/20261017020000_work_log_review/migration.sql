-- CreateEnum
CREATE TYPE "WorkLogRating" AS ENUM ('GOOD', 'NEEDS_WORK');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WORKLOG_REVIEW';

-- AlterTable
ALTER TABLE "WorkLogEntry" ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WorkLogReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" "WorkLogPeriod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rating" "WorkLogRating",
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLogReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkLogReview_reviewerId_idx" ON "WorkLogReview"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLogReview_userId_period_periodStart_key" ON "WorkLogReview"("userId", "period", "periodStart");

-- AddForeignKey
ALTER TABLE "WorkLogReview" ADD CONSTRAINT "WorkLogReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogReview" ADD CONSTRAINT "WorkLogReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


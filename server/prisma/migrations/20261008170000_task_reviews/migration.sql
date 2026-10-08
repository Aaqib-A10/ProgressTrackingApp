-- CreateEnum
CREATE TYPE "PmReviewVerdict" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_REVIEW';

-- CreateTable
CREATE TABLE "PmReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "verdict" "PmReviewVerdict" NOT NULL DEFAULT 'COMMENT',
    "rating" INTEGER,
    "body" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PmReview_taskId_createdAt_idx" ON "PmReview"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "PmReview_reviewerId_idx" ON "PmReview"("reviewerId");

-- AddForeignKey
ALTER TABLE "PmReview" ADD CONSTRAINT "PmReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmReview" ADD CONSTRAINT "PmReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


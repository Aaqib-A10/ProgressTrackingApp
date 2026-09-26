-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'MARKETING_TASK';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_SOON';

-- AlterTable
ALTER TABLE "EntryAttachment" ADD COLUMN     "taskId" TEXT,
ALTER COLUMN "date" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MarketingTask" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "dueReminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EntryAttachment_taskId_idx" ON "EntryAttachment"("taskId");

-- CreateIndex
CREATE INDEX "MarketingTask_priority_dueAt_idx" ON "MarketingTask"("priority", "dueAt");

-- AddForeignKey
ALTER TABLE "EntryAttachment" ADD CONSTRAINT "EntryAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

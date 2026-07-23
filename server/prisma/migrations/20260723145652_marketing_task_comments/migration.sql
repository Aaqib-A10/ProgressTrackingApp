-- CreateTable
CREATE TABLE "MarketingTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingTaskComment_taskId_idx" ON "MarketingTaskComment"("taskId");

-- AddForeignKey
ALTER TABLE "MarketingTaskComment" ADD CONSTRAINT "MarketingTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTaskComment" ADD CONSTRAINT "MarketingTaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

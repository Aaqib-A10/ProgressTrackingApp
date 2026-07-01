-- CreateTable
CREATE TABLE "EcomTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcomTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcomTaskComment_taskId_idx" ON "EcomTaskComment"("taskId");

-- AddForeignKey
ALTER TABLE "EcomTaskComment" ADD CONSTRAINT "EcomTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "EcommerceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcomTaskComment" ADD CONSTRAINT "EcomTaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

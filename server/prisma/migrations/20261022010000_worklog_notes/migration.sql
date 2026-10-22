-- CreateTable
CREATE TABLE "WorkLogNote" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT,
    "sender" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLogNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkLogNote_entryId_idx" ON "WorkLogNote"("entryId");

-- CreateIndex
CREATE INDEX "WorkLogNote_userId_source_idx" ON "WorkLogNote"("userId", "source");

-- AddForeignKey
ALTER TABLE "WorkLogNote" ADD CONSTRAINT "WorkLogNote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WorkLogEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogNote" ADD CONSTRAINT "WorkLogNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


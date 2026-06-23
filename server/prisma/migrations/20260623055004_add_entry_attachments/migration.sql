-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('ITAD', 'LEAD_GEN');

-- CreateTable
CREATE TABLE "EntryAttachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "date" DATE NOT NULL,
    "storedName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntryAttachment_userId_kind_date_idx" ON "EntryAttachment"("userId", "kind", "date");

-- AddForeignKey
ALTER TABLE "EntryAttachment" ADD CONSTRAINT "EntryAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

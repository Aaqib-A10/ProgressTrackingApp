-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "callId" TEXT;

-- CreateTable
CREATE TABLE "ChatCall" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "video" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "joinedIds" TEXT[],

    CONSTRAINT "ChatCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatCall_conversationId_endedAt_idx" ON "ChatCall"("conversationId", "endedAt");

-- AddForeignKey
ALTER TABLE "ChatCall" ADD CONSTRAINT "ChatCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatCall" ADD CONSTRAINT "ChatCall_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_callId_fkey" FOREIGN KEY ("callId") REFERENCES "ChatCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

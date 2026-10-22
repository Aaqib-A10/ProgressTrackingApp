-- AlterTable
ALTER TABLE "PmProject" ADD COLUMN     "workFolder" TEXT;

-- CreateTable
CREATE TABLE "ClaudeKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaudeKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeKey_tokenHash_key" ON "ClaudeKey"("tokenHash");

-- CreateIndex
CREATE INDEX "ClaudeKey_userId_idx" ON "ClaudeKey"("userId");

-- AddForeignKey
ALTER TABLE "ClaudeKey" ADD CONSTRAINT "ClaudeKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NETWORK_BLOCKED';

-- CreateTable
CREATE TABLE "BlockedCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockedCheckIn_createdAt_idx" ON "BlockedCheckIn"("createdAt");

-- CreateIndex
CREATE INDEX "BlockedCheckIn_ip_idx" ON "BlockedCheckIn"("ip");

-- AddForeignKey
ALTER TABLE "BlockedCheckIn" ADD CONSTRAINT "BlockedCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


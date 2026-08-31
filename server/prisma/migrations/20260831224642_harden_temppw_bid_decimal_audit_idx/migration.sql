-- AlterTable
ALTER TABLE "Bid" ALTER COLUMN "priceQuoted" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "awardedPrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "bidBondAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "tempPassword";

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");


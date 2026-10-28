-- Team leads fix breaks and overtime, break cut-off, stock edit (E-commerce, Oct 2026). Adds only.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BREAK_CUTOFF';
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_EDITED';

-- AlterTable
ALTER TABLE "AttendanceShift" ADD COLUMN     "brbCutoffMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "breakCutoffMin" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "BreakEntry" ADD COLUMN     "autoEnded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT;

-- AlterTable
ALTER TABLE "StockRequest" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT,
ADD COLUMN     "quantity" INTEGER;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


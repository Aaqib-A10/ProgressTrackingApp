-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('BREAK', 'BRB');

-- CreateEnum
CREATE TYPE "ViolationKind" AS ENUM ('LATE_SIGNIN', 'BREAK_OVERRUN', 'BRB_OVERRUN', 'LATE_LIMIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'GRACE_EXCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'BREAK_OVERRUN';
ALTER TYPE "NotificationType" ADD VALUE 'BRB_OVERRUN';
ALTER TYPE "NotificationType" ADD VALUE 'GRACE_LIMIT';

-- AlterTable
ALTER TABLE "AttendanceShift" ADD COLUMN     "brbAllowanceMin" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "breakAllowanceMin" INTEGER NOT NULL DEFAULT 65;

-- AlterTable
ALTER TABLE "BreakEntry" ADD COLUMN     "type" "BreakType" NOT NULL DEFAULT 'BREAK';

-- CreateTable
CREATE TABLE "AttendanceViolation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ViolationKind" NOT NULL,
    "minutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceViolation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceViolation_userId_date_idx" ON "AttendanceViolation"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceViolation_userId_date_kind_key" ON "AttendanceViolation"("userId", "date", "kind");

-- AddForeignKey
ALTER TABLE "AttendanceViolation" ADD CONSTRAINT "AttendanceViolation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

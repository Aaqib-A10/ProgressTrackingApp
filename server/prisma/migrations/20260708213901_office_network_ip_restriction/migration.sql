-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "checkInIp" TEXT,
ADD COLUMN     "checkOutIp" TEXT;

-- CreateTable
CREATE TABLE "OfficeNetwork" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeNetwork_pkey" PRIMARY KEY ("id")
);

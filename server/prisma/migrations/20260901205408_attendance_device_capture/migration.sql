-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "checkInMobile" BOOLEAN,
ADD COLUMN     "checkInUa" TEXT,
ADD COLUMN     "checkOutMobile" BOOLEAN,
ADD COLUMN     "checkOutUa" TEXT;

-- AlterTable
ALTER TABLE "BreakEntry" ADD COLUMN     "endMobile" BOOLEAN,
ADD COLUMN     "endUa" TEXT,
ADD COLUMN     "startMobile" BOOLEAN,
ADD COLUMN     "startUa" TEXT;


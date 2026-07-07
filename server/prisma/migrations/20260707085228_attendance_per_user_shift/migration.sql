-- AlterTable: per-account shift override + full-shift target
ALTER TABLE "AttendanceShift" ADD COLUMN "userId" TEXT,
ADD COLUMN "requiredMinutes" INTEGER NOT NULL DEFAULT 480;

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceShift_userId_key" ON "AttendanceShift"("userId");

-- AddForeignKey
ALTER TABLE "AttendanceShift" ADD CONSTRAINT "AttendanceShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

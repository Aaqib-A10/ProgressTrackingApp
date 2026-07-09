-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateTable
CREATE TABLE "AttendanceReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceReminder_date_idx" ON "AttendanceReminder"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceReminder_userId_date_kind_key" ON "AttendanceReminder"("userId", "date", "kind");

-- AddForeignKey
ALTER TABLE "AttendanceReminder" ADD CONSTRAINT "AttendanceReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

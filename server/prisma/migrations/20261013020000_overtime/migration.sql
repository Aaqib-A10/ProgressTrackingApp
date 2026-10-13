-- Overtime: someone can keep working after their shift's hours instead of being checked out.
ALTER TABLE "AttendanceDay" ADD COLUMN "overtimeAt" TIMESTAMP(3);

-- In-app notice when PulseTrack checks someone out by itself.
ALTER TYPE "NotificationType" ADD VALUE 'AUTO_CHECKOUT';

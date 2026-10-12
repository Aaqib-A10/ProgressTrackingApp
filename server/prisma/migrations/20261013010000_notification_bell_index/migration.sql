-- The bell asks for "my unread notifications, newest first": one index answers it directly.
DROP INDEX IF EXISTS "Notification_userId_readAt_idx";
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

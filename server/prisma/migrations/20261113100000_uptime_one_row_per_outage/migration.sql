-- The uptime checker could report the same outage twice (its first reply got lost).
-- Keep the first row of each, then let the database refuse a second one.
DELETE FROM "UptimeEvent" a USING "UptimeEvent" b
WHERE a."downAt" = b."downAt" AND a."createdAt" > b."createdAt";
DELETE FROM "UptimeEvent" a USING "UptimeEvent" b
WHERE a."downAt" = b."downAt" AND a."createdAt" = b."createdAt" AND a."id" > b."id";

-- DropIndex
DROP INDEX IF EXISTS "UptimeEvent_downAt_idx";

-- CreateIndex
CREATE UNIQUE INDEX "UptimeEvent_downAt_key" ON "UptimeEvent"("downAt");

-- CreateEnum
CREATE TYPE "ErrorSource" AS ENUM ('SERVER', 'BROWSER', 'JOB', 'SLOW');

-- CreateEnum
CREATE TYPE "ErrorState" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "AuditState" AS ENUM ('RUNNING', 'PASSED', 'WARN', 'FAILED');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'WARN', 'FAIL', 'SKIP');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM_HEALTH';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isDeveloper" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "ErrorSource" NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "status" INTEGER,
    "count" INTEGER NOT NULL DEFAULT 1,
    "userIds" TEXT[],
    "state" "ErrorState" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "reopenedAt" TIMESTAMP(3),

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "url" TEXT,
    "status" INTEGER,
    "durationMs" INTEGER,
    "meta" JSONB,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedById" TEXT,
    "state" "AuditState" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "warned" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "newProblems" INTEGER NOT NULL DEFAULT 0,
    "fixed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "result" "CheckResult" NOT NULL,
    "ms" INTEGER,
    "status" INTEGER,
    "detail" TEXT,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "fixed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuditCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobHeartbeat" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "UptimeEvent" (
    "id" TEXT NOT NULL,
    "downAt" TIMESTAMP(3) NOT NULL,
    "upAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UptimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_fingerprint_key" ON "ErrorGroup"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorGroup_state_lastSeenAt_idx" ON "ErrorGroup"("state", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "ErrorGroup_source_lastSeenAt_idx" ON "ErrorGroup"("source", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "ErrorEvent_groupId_at_idx" ON "ErrorEvent"("groupId", "at" DESC);

-- CreateIndex
CREATE INDEX "ErrorEvent_at_idx" ON "ErrorEvent"("at");

-- CreateIndex
CREATE INDEX "AuditRun_startedAt_idx" ON "AuditRun"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "AuditCheck_runId_idx" ON "AuditCheck"("runId");

-- CreateIndex
CREATE INDEX "AuditCheck_category_name_idx" ON "AuditCheck"("category", "name");

-- CreateIndex
CREATE INDEX "UptimeEvent_downAt_idx" ON "UptimeEvent"("downAt" DESC);

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCheck" ADD CONSTRAINT "AuditCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

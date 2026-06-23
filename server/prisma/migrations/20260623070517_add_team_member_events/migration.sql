-- CreateEnum
CREATE TYPE "TeamEventType" AS ENUM ('INVITED', 'REMOVED', 'REACTIVATED');

-- CreateTable
CREATE TABLE "TeamMemberEvent" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "memberId" TEXT,
    "memberName" TEXT NOT NULL,
    "memberEmail" TEXT NOT NULL,
    "type" "TeamEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMemberEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamMemberEvent_departmentId_createdAt_idx" ON "TeamMemberEvent"("departmentId", "createdAt");

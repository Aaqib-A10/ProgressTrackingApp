-- CreateEnum
CREATE TYPE "WorkLogPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "WorkLogStatus" AS ENUM ('PLANNED', 'DONE');

-- CreateTable
CREATE TABLE "WorkLogEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" "WorkLogPeriod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "status" "WorkLogStatus" NOT NULL DEFAULT 'PLANNED',
    "doneAt" TIMESTAMP(3),
    "hours" DOUBLE PRECISION,
    "quantity" INTEGER,
    "tag" TEXT,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkLogEntry_userId_periodStart_idx" ON "WorkLogEntry"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "WorkLogEntry_userId_period_periodStart_idx" ON "WorkLogEntry"("userId", "period", "periodStart");

-- AddForeignKey
ALTER TABLE "WorkLogEntry" ADD CONSTRAINT "WorkLogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


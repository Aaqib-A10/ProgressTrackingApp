-- AlterEnum
ALTER TYPE "DepartmentType" ADD VALUE 'TALKLOOP';

-- AlterEnum
ALTER TYPE "TagType" ADD VALUE 'COUNTRY';

-- CreateTable
CREATE TABLE "TalkloopDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "callsMade" INTEGER NOT NULL DEFAULT 0,
    "connects" INTEGER NOT NULL DEFAULT 0,
    "demosScheduled" INTEGER NOT NULL DEFAULT 0,
    "demosConducted" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalkloopDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalkloopCountryCount" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "demos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TalkloopCountryCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TalkloopDailyEntry_date_idx" ON "TalkloopDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "TalkloopDailyEntry_userId_date_key" ON "TalkloopDailyEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TalkloopCountryCount_entryId_tagId_key" ON "TalkloopCountryCount"("entryId", "tagId");

-- AddForeignKey
ALTER TABLE "TalkloopDailyEntry" ADD CONSTRAINT "TalkloopDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalkloopCountryCount" ADD CONSTRAINT "TalkloopCountryCount_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TalkloopDailyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalkloopCountryCount" ADD CONSTRAINT "TalkloopCountryCount_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

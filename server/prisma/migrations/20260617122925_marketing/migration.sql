-- CreateEnum
CREATE TYPE "MarketingDiscipline" AS ENUM ('SEO', 'SOCIAL', 'CONTENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('BLOG', 'LANDING_PAGE', 'SOCIAL_COPY', 'VIDEO_SCRIPT', 'EMAIL', 'OTHER');

-- CreateTable
CREATE TABLE "SeoDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "keywordsTracked" INTEGER NOT NULL DEFAULT 0,
    "pagesOptimized" INTEGER NOT NULL DEFAULT 0,
    "backlinksBuilt" INTEGER NOT NULL DEFAULT 0,
    "technicalFixes" INTEGER NOT NULL DEFAULT 0,
    "organicTraffic" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialDailyEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'SUBMITTED',
    "postsPublished" INTEGER NOT NULL DEFAULT 0,
    "postsScheduled" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "engagement" INTEGER NOT NULL DEFAULT 0,
    "followersGained" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialDailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPlatformCount" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "posts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SocialPlatformCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discipline" "MarketingDiscipline" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'BACKLOG',
    "order" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "contentType" "ContentType",
    "wordCount" INTEGER,
    "wordTarget" INTEGER,
    "dueDate" DATE,
    "scheduledDate" DATE,
    "publishedDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoDailyEntry_date_idx" ON "SeoDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SeoDailyEntry_userId_date_key" ON "SeoDailyEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "SocialDailyEntry_date_idx" ON "SocialDailyEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SocialDailyEntry_userId_date_key" ON "SocialDailyEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPlatformCount_entryId_tagId_key" ON "SocialPlatformCount"("entryId", "tagId");

-- CreateIndex
CREATE INDEX "MarketingTask_status_idx" ON "MarketingTask"("status");

-- CreateIndex
CREATE INDEX "MarketingTask_discipline_idx" ON "MarketingTask"("discipline");

-- CreateIndex
CREATE INDEX "MarketingTask_scheduledDate_idx" ON "MarketingTask"("scheduledDate");

-- AddForeignKey
ALTER TABLE "SeoDailyEntry" ADD CONSTRAINT "SeoDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialDailyEntry" ADD CONSTRAINT "SocialDailyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPlatformCount" ADD CONSTRAINT "SocialPlatformCount_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SocialDailyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPlatformCount" ADD CONSTRAINT "SocialPlatformCount_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

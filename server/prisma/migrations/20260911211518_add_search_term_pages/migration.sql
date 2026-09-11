-- CreateEnum
CREATE TYPE "SearchTermStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'LIVE');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "searchTermTarget" INTEGER;

-- CreateTable
CREATE TABLE "SearchTermPage" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "url" TEXT,
    "status" "SearchTermStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchTermPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchTermPage_brandId_idx" ON "SearchTermPage"("brandId");

-- AddForeignKey
ALTER TABLE "SearchTermPage" ADD CONSTRAINT "SearchTermPage_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

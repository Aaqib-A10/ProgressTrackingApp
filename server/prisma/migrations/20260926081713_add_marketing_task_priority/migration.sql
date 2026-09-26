-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "MarketingTask" ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MEDIUM';

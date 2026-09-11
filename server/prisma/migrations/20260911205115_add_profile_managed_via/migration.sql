-- CreateEnum
CREATE TYPE "ManagedVia" AS ENUM ('MIXPOST', 'MANUAL');

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "managedVia" "ManagedVia" NOT NULL DEFAULT 'MANUAL';

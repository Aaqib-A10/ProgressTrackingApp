-- AlterEnum
ALTER TYPE "BidType" ADD VALUE 'PO';

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "bidBond" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bidBondAmount" DOUBLE PRECISION;

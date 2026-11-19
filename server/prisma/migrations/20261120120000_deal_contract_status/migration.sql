-- Deal Tracker: a Contract status (won and signed as a contract) and its optional start and end dates. Nothing existing changes.
ALTER TYPE "BidStatus" ADD VALUE IF NOT EXISTS 'CONTRACT';
ALTER TABLE "Bid" ADD COLUMN "contractStart" DATE;
ALTER TABLE "Bid" ADD COLUMN "contractEnd" DATE;

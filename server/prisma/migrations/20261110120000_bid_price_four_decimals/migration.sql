-- Buyback rates are quoted in cents per lb (12.5¢ = 0.125): two decimal places rounded them away.
ALTER TABLE "Bid" ALTER COLUMN "priceQuoted" TYPE DECIMAL(12,4);
ALTER TABLE "Bid" ALTER COLUMN "awardedPrice" TYPE DECIMAL(12,4);

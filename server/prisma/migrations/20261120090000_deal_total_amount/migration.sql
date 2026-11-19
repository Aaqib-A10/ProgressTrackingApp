-- Deal Tracker: the deal's full dollar figure (Price Quoted / Awarded Price are often per-lb rates). Optional; existing deals stay empty.
ALTER TABLE "Bid" ADD COLUMN "totalAmount" DECIMAL(14,2);

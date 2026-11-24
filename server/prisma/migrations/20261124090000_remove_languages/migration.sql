-- Urdu and Arabic menus were taken out (24 Nov 2026): the saved choice of language is no longer kept.
ALTER TABLE "User" DROP COLUMN "language";

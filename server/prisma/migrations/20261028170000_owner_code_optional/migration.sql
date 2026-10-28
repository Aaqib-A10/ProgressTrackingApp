-- The phone code at owner sign in is optional (password only until it is switched on).
ALTER TABLE "PlatformOwner" ALTER COLUMN "totpSecret" DROP NOT NULL;

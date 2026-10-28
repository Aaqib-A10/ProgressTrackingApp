-- Owners can sign in with a short name instead of the email (used by the local test owner).
ALTER TABLE "PlatformOwner" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "PlatformOwner_username_key" ON "PlatformOwner"("username");

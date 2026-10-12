-- Links that let people outside Metriq ask to join a chat's calls.
ALTER TABLE "ChatConversation" ADD COLUMN "guestToken" TEXT;
CREATE UNIQUE INDEX "ChatConversation_guestToken_key" ON "ChatConversation"("guestToken");

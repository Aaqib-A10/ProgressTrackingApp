-- Who changed a project / group picture, and app lines in chats ("X changed the picture").
ALTER TABLE "PmProject" ADD COLUMN "avatarById" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN "avatarById" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "system" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PmProject" ADD COLUMN     "avatarAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "avatarAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "autoNotes" BOOLEAN NOT NULL DEFAULT true;

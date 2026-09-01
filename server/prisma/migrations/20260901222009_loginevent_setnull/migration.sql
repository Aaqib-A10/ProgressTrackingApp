-- DropForeignKey
ALTER TABLE "LoginEvent" DROP CONSTRAINT "LoginEvent_userId_fkey";

-- AlterTable
ALTER TABLE "LoginEvent" ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


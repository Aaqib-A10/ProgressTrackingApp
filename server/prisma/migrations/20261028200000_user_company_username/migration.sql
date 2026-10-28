-- People belong to a company (empty = 99 Technologies until phase 1 step 2) and may sign in
-- with a short username. A company is a team or a personal workspace (one person, solo use).
CREATE TYPE "CompanyKind" AS ENUM ('TEAM', 'PERSONAL');
ALTER TABLE "Company" ADD COLUMN "kind" "CompanyKind" NOT NULL DEFAULT 'TEAM';
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_companyId_idx" ON "User"("companyId");
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

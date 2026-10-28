-- Phase 1, step 8: billing (subscriptions, invoices, payment provider messages).
-- 99 Technologies (internal plan) is never billed.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'FAILED', 'VOID');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "trialEndedMailAt" TIMESTAMP(3),
ADD COLUMN     "trialEndingMailAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "customerId" TEXT,
    "plan" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "number" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "plan" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "hostedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "companyId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_companyId_key" ON "Subscription"("companyId");

-- CreateIndex
CREATE INDEX "Subscription_provider_externalId_idx" ON "Subscription"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_companyId_createdAt_idx" ON "Invoice"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_provider_externalId_key" ON "Invoice"("provider", "externalId");

-- CreateIndex
CREATE INDEX "BillingEvent_receivedAt_idx" ON "BillingEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_externalId_key" ON "BillingEvent"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Company walls for the new company tables.
CREATE OR REPLACE FUNCTION "mq_wall_Subscription"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a Subscription row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "Subscription_company_wall" ON "Subscription";
CREATE TRIGGER "Subscription_company_wall" BEFORE INSERT OR UPDATE ON "Subscription" FOR EACH ROW EXECUTE FUNCTION "mq_wall_Subscription"();

CREATE OR REPLACE FUNCTION "mq_wall_Invoice"() RETURNS trigger AS $$
DECLARE c TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'metriq company wall: a Invoice row cannot move to another company' USING ERRCODE = 'P0420';
  END IF;
  IF NEW."companyId" IS NULL OR NEW."companyId" = '' THEN
    NULL;
    NEW."companyId" := COALESCE(c, 'company-1');
    c := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "Invoice_company_wall" ON "Invoice";
CREATE TRIGGER "Invoice_company_wall" BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION "mq_wall_Invoice"();


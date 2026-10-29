-- A rep can change a lead's status in Metriq. Until Earthzone shows it, an import that still
-- brings the old CRM status does not undo it.
ALTER TABLE "DialerLead" ADD COLUMN "statusHere" TEXT;
ALTER TABLE "DialerLead" ADD COLUMN "statusHereFrom" TEXT;
ALTER TABLE "DialerLead" ADD COLUMN "statusHereAt" TIMESTAMP(3);
ALTER TABLE "DialerStatusChange" ADD COLUMN "byName" TEXT;

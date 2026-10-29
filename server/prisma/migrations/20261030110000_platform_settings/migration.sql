-- Settings for the whole of Metriq kept by the owner (seller details on invoices). No secrets here.
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

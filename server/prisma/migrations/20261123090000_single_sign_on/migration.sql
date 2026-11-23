-- Single sign-on (SAML) settings of a company. All off by default: nothing changes until a company sets it up.
ALTER TABLE "Company" ADD COLUMN "ssoOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ssoEntryPoint" TEXT,
ADD COLUMN "ssoIdpIssuer" TEXT,
ADD COLUMN "ssoCert" TEXT,
ADD COLUMN "ssoDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "ssoRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ssoCreatePeople" BOOLEAN NOT NULL DEFAULT false;

-- The language a person reads Metriq's menus in (Settings, Language). Null is English.
ALTER TABLE "User" ADD COLUMN "language" TEXT;

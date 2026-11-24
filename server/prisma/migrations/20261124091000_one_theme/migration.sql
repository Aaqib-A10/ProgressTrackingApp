-- One look in light and dark (24 Nov 2026): the six extra colour themes were taken out, so a saved pick of one goes back to Metriq's own.
UPDATE "User" SET "uiTheme" = NULL WHERE "uiTheme" IS NOT NULL;
UPDATE "Company" SET "theme" = NULL WHERE "theme" IS NOT NULL;

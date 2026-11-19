-- Colour themes (client/src/theme): the theme each person picked, and each company's default theme and brand colour.
-- Additive only: three optional columns, empty for everyone (empty = today's look).
-- Rollback: drop the three columns.

ALTER TABLE "User" ADD COLUMN "uiTheme" TEXT;
ALTER TABLE "Company" ADD COLUMN "theme" TEXT;
ALTER TABLE "Company" ADD COLUMN "brandColor" TEXT;

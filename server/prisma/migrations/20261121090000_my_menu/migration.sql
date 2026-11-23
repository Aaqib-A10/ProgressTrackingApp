-- My menu: the sidebar items each person chose to hide for themselves. Empty for everyone; nothing existing changes.
ALTER TABLE "User" ADD COLUMN     "navHidden" TEXT[] DEFAULT ARRAY[]::TEXT[];

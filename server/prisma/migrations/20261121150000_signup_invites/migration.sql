-- Sign-up by invite link while public sign-up is off (owner console → Invites). A platform table: it belongs to no company.
CREATE TABLE "SignupInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignupInvite_code_key" ON "SignupInvite"("code");

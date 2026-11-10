-- Better Auth username plugin. Existing email/OAuth accounts remain valid.
ALTER TABLE "user" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "user_username_uidx" ON "user" ("username");

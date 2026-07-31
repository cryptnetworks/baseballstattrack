ALTER TABLE "Account"
  ADD COLUMN "externalId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Team"
  ADD COLUMN "externalId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Season"
  ADD COLUMN "externalId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Player"
  ADD COLUMN "externalId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Game"
  ADD COLUMN "externalId" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "Account_externalId_key" ON "Account"("externalId");
CREATE UNIQUE INDEX "Team_accountId_externalId_key"
  ON "Team"("accountId", "externalId");
CREATE UNIQUE INDEX "Season_accountId_externalId_key"
  ON "Season"("accountId", "externalId");
CREATE UNIQUE INDEX "Player_accountId_externalId_key"
  ON "Player"("accountId", "externalId");
CREATE UNIQUE INDEX "Game_accountId_externalId_key"
  ON "Game"("accountId", "externalId");

DROP TRIGGER "Account_identity_immutable" ON "Account";
CREATE TRIGGER "Account_identity_immutable" BEFORE UPDATE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'externalId');
DROP TRIGGER "Team_identity_immutable" ON "Team";
CREATE TRIGGER "Team_identity_immutable" BEFORE UPDATE ON "Team"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'externalId', 'accountId');
DROP TRIGGER "Season_identity_immutable" ON "Season";
CREATE TRIGGER "Season_identity_immutable" BEFORE UPDATE ON "Season"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'externalId', 'accountId');
DROP TRIGGER "Player_identity_immutable" ON "Player";
CREATE TRIGGER "Player_identity_immutable" BEFORE UPDATE ON "Player"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'externalId', 'accountId');
DROP TRIGGER "Game_identity_immutable" ON "Game";
CREATE TRIGGER "Game_identity_immutable" BEFORE UPDATE ON "Game"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'externalId', 'accountId', 'seasonId', 'teamSeasonId');

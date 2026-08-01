CREATE INDEX "DiscordUpdateEvaluation_accountId_gameId_idx"
  ON "DiscordUpdateEvaluation"("accountId", "gameId");

CREATE INDEX "DiscordUpdateDelivery_accountId_destinationId_idx"
  ON "DiscordUpdateDelivery"("accountId", "destinationId");

CREATE INDEX "DiscordUpdateDelivery_accountId_evaluationId_idx"
  ON "DiscordUpdateDelivery"("accountId", "evaluationId");

CREATE INDEX "DiscordUpdateDelivery_accountId_gameId_idx"
  ON "DiscordUpdateDelivery"("accountId", "gameId");

CREATE INDEX "DiscordUpdateDeliveryAttempt_accountId_deliveryId_idx"
  ON "DiscordUpdateDeliveryAttempt"("accountId", "deliveryId");

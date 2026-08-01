import { DiscordDestinationPurpose, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

const model = (name: string) => {
  const found = Prisma.dmmf.datamodel.models.find(
    (candidate) => candidate.name === name,
  );

  expect(found, `missing Prisma model ${name}`).toBeDefined();
  return found!;
};

describe("relational domain schema", () => {
  it("models the normalized account-owned baseball boundaries", () => {
    for (const name of [
      "Account",
      "Team",
      "Season",
      "TeamSeason",
      "Player",
      "RosterEntry",
      "Game",
      "GameSetupSnapshot",
      "GameTeamSnapshot",
      "LineupSlotSnapshot",
      "PlayTransaction",
      "SourceEvent",
      "EventCorrection",
      "AnalyticsObservation",
      "ProjectionCheckpoint",
      "PrivacyOverlay",
      "DataExportArtifact",
      "PrivacyLifecycleRequest",
      "PrivacyHold",
      "RateLimitCounter",
      "RateLimitCharge",
      "RateLimitOverride",
      "NotificationPreference",
      "NotificationDelivery",
      "NotificationDeliveryAttempt",
      "DiscordInstallation",
      "DiscordChannelDestination",
      "DiscordIntegrationSettings",
      "DiscordSettingsScope",
      "DiscordSettingsDestination",
      "DiscordUpdateEvaluation",
      "DiscordUpdateDelivery",
      "DiscordUpdateDeliveryAttempt",
    ]) {
      expect(model(name).name).toBe(name);
    }
  });

  it("keeps notification rules and delivery evidence separate from analytics", () => {
    const preferenceFields = new Set(
      model("NotificationPreference").fields.map((field) => field.name),
    );
    const deliveryFields = new Set(
      model("NotificationDelivery").fields.map((field) => field.name),
    );
    for (const required of [
      "accountId",
      "membershipId",
      "teamId",
      "channel",
      "destinationReference",
      "subscribedEvents",
      "status",
    ]) {
      expect(preferenceFields).toContain(required);
    }
    for (const required of [
      "accountId",
      "preferenceId",
      "eventId",
      "messageVersion",
      "attemptCount",
      "leaseOwner",
      "retentionUntil",
    ]) {
      expect(deliveryFields).toContain(required);
    }
    expect(preferenceFields).not.toContain("analyticsObservationId");
    expect(deliveryFields).not.toContain("insightId");
  });

  it("separates Discord server identity from editable versioned settings", () => {
    const installationFields = new Set(
      model("DiscordInstallation").fields.map((field) => field.name),
    );
    const settingsFields = new Set(
      model("DiscordIntegrationSettings").fields.map((field) => field.name),
    );
    const destinationFields = new Set(
      model("DiscordChannelDestination").fields.map((field) => field.name),
    );
    for (const required of ["guildId", "credentialReference", "status"]) {
      expect(installationFields).toContain(required);
    }
    for (const required of [
      "schemaVersion",
      "revision",
      "enabled",
      "cadenceMode",
      "cadenceSeconds",
      "gameDayWindowEnabled",
      "digestEnabled",
      "catchUpPolicy",
      "triggers",
      "messageStrategy",
      "messageFormat",
      "quietHoursEnabled",
      "pausedAt",
      "manualRefreshRequestedAt",
      "nextScheduledEvaluationAt",
      "lastSuccessfulUpdateAt",
    ]) {
      expect(settingsFields).toContain(required);
    }
    expect(settingsFields).not.toContain("guildId");
    expect(settingsFields).not.toContain("credentialReference");
    for (const required of [
      "enabled",
      "canView",
      "canSend",
      "lastVerifiedAt",
    ]) {
      expect(destinationFields).toContain(required);
    }
  });

  it("defines each independently routable Discord delivery category", () => {
    expect(Object.values(DiscordDestinationPurpose)).toEqual([
      "LIVE_UPDATES",
      "FINAL_SCORES",
      "CORRECTIONS",
      "SUMMARIES",
      "ERRORS",
      "DIGESTS",
    ]);
  });

  it("keeps prohibited MVP player fields out of persistence", () => {
    const playerFields = model("Player").fields.map((field) =>
      field.name.toLowerCase(),
    );

    for (const prohibited of [
      "dateofbirth",
      "birthyear",
      "ageband",
      "email",
      "phone",
      "notes",
      "contact",
    ]) {
      expect(playerFields).not.toContain(prohibited);
    }
  });

  it("models stable player identity and versioned roster periods", () => {
    const playerFields = new Set(
      model("Player").fields.map((field) => field.name),
    );
    const rosterFields = new Set(
      model("RosterEntry").fields.map((field) => field.name),
    );

    for (const required of ["battingSide", "throwingHand", "revision"]) {
      expect(playerFields).toContain(required);
    }
    for (const required of [
      "primaryPosition",
      "startsAt",
      "endsAt",
      "revision",
    ]) {
      expect(rosterFields).toContain(required);
    }
  });

  it("preserves event envelope and privacy-aware projection revisions", () => {
    const eventFields = new Set(
      model("SourceEvent").fields.map((field) => field.name),
    );

    for (const required of [
      "accountId",
      "gameId",
      "sequence",
      "eventType",
      "schemaVersion",
      "rulesetVersionId",
      "setupSnapshotId",
      "clientSubmissionId",
      "expectedRevision",
      "acceptedRevision",
      "actorId",
      "recordedAt",
      "payload",
    ]) {
      expect(eventFields).toContain(required);
    }

    expect(
      model("ProjectionCheckpoint").fields.some(
        (field) => field.name === "privacyOverlayRevision",
      ),
    ).toBe(true);
    expect(
      model("EventCorrection").fields.some(
        (field) => field.name === "replacementPayloadId",
      ),
    ).toBe(true);
  });

  it("keeps optional analytics observations separate from canonical events", () => {
    const fields = new Set(
      model("AnalyticsObservation").fields.map((field) => field.name),
    );
    for (const required of [
      "accountId",
      "gameId",
      "setupSnapshotId",
      "sourceEventId",
      "type",
      "version",
      "ordinal",
      "captureSource",
      "confidence",
      "payload",
      "supersedesObservationId",
    ]) {
      expect(fields).toContain(required);
    }
    expect(fields).not.toContain("playerDisplayName");
    expect(fields).not.toContain("video");
  });

  it("keeps setup and scoring revisions separate with an exact ready pointer", () => {
    const gameFields = new Set(model("Game").fields.map((field) => field.name));
    const setupFields = new Set(
      model("GameSetupSnapshot").fields.map((field) => field.name),
    );

    for (const required of [
      "revision",
      "setupRevision",
      "readySetupSnapshotId",
      "weatherCondition",
      "temperatureF",
    ]) {
      expect(gameFields).toContain(required);
    }
    for (const required of [
      "createdByActorId",
      "clientSubmissionId",
      "payloadHash",
      "weatherCondition",
      "temperatureF",
    ]) {
      expect(setupFields).toContain(required);
    }
  });
});

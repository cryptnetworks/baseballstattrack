import { Prisma } from "@prisma/client";
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
      "ProjectionCheckpoint",
      "PrivacyOverlay",
      "DataExportArtifact",
      "PrivacyLifecycleRequest",
      "PrivacyHold",
      "RateLimitCounter",
      "RateLimitCharge",
      "RateLimitOverride",
    ]) {
      expect(model(name).name).toBe(name);
    }
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

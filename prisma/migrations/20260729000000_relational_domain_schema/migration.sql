-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'SUSPENDED', 'PENDING_DELETION');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED', 'REMOVED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMINISTRATOR', 'COACH_MANAGER', 'SCOREKEEPER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuthorizationScope" AS ENUM ('ACCOUNT', 'TEAM', 'SEASON', 'GAME');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('DRAFT', 'READY', 'IN_PROGRESS', 'SUSPENDED', 'COMPLETED', 'VERIFIED', 'CORRECTED', 'ABANDONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GameSide" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "BaseballPosition" AS ENUM ('PITCHER', 'CATCHER', 'FIRST_BASE', 'SECOND_BASE', 'THIRD_BASE', 'SHORTSTOP', 'LEFT_FIELD', 'CENTER_FIELD', 'RIGHT_FIELD', 'DESIGNATED_HITTER', 'EXTRA_HITTER');

-- CreateEnum
CREATE TYPE "RulesetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('USER', 'SERVICE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProjectionScope" AS ENUM ('GAME', 'SEASON');

-- CreateEnum
CREATE TYPE "ProjectionStatus" AS ENUM ('PENDING', 'BUILDING', 'CURRENT', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCEEDED', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrivacyDisplayField" AS ENUM ('PLAYER_DISPLAY_NAME');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "detachedAt" TIMESTAMP(3),

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipRoleAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "scope" "AuthorizationScope" NOT NULL DEFAULT 'ACCOUNT',
    "teamId" TEXT,
    "seasonId" TEXT,
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MembershipRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "scope" "AuthorizationScope" NOT NULL DEFAULT 'ACCOUNT',
    "teamId" TEXT,
    "seasonId" TEXT,
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "color" TEXT,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSeason" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "TeamSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamSeasonId" TEXT NOT NULL,
    "jerseyNumber" TEXT,
    "status" "RosterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "RosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulesetVersion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "status" "RulesetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "RulesetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamSeasonId" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameTeamSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "side" "GameSide" NOT NULL,
    "teamId" TEXT,
    "teamSeasonId" TEXT,
    "displayName" TEXT NOT NULL,
    "isAccountTeam" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTeamSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSetupSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "setupRevision" INTEGER NOT NULL,
    "rulesetVersionId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSetupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineupSlotSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "setupSnapshotId" TEXT NOT NULL,
    "gameTeamSnapshotId" TEXT NOT NULL,
    "playerId" TEXT,
    "rosterEntryId" TEXT,
    "displayName" TEXT NOT NULL,
    "jerseyNumber" TEXT,
    "battingOrder" INTEGER NOT NULL,
    "defensivePosition" "BaseballPosition",
    "isStartingPitcher" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineupSlotSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "acceptedRevision" INTEGER NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "clientSubmissionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playTransactionId" TEXT,
    "sequence" INTEGER NOT NULL,
    "componentOrder" INTEGER,
    "eventType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "rulesetVersionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "preStateHash" TEXT,
    "postStateHash" TEXT,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSupersession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "supersededEventId" TEXT NOT NULL,
    "replacementEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSupersession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectionCheckpoint" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scope" "ProjectionScope" NOT NULL,
    "gameId" TEXT,
    "seasonId" TEXT,
    "sourceRevision" INTEGER NOT NULL,
    "privacyOverlayRevision" INTEGER NOT NULL DEFAULT 0,
    "derivationVersion" INTEGER NOT NULL,
    "status" "ProjectionStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAuditRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "capability" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "reasonCode" TEXT,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyOverlay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "effectiveOrder" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyOverlayField" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "privacyOverlayId" TEXT NOT NULL,
    "playerId" TEXT,
    "lineupSlotSnapshotId" TEXT,
    "field" "PrivacyDisplayField" NOT NULL,
    "replacementValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyOverlayField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_slug_key" ON "Account"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_providerSubject_key" ON "AppUser"("providerSubject");

-- CreateIndex
CREATE INDEX "AccountMembership_userId_status_idx" ON "AccountMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMembership_accountId_userId_key" ON "AccountMembership"("accountId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMembership_accountId_id_key" ON "AccountMembership"("accountId", "id");

-- CreateIndex
CREATE INDEX "MembershipRoleAssignment_accountId_membershipId_revokedAt_idx" ON "MembershipRoleAssignment"("accountId", "membershipId", "revokedAt");

-- CreateIndex
CREATE INDEX "MembershipRoleAssignment_accountId_scope_teamId_seasonId_ga_idx" ON "MembershipRoleAssignment"("accountId", "scope", "teamId", "seasonId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipRoleAssignment_accountId_id_key" ON "MembershipRoleAssignment"("accountId", "id");

-- CreateIndex
CREATE INDEX "CapabilityGrant_accountId_membershipId_revokedAt_idx" ON "CapabilityGrant"("accountId", "membershipId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityGrant_accountId_membershipId_capability_scope_tea_key" ON "CapabilityGrant"("accountId", "membershipId", "capability", "scope", "teamId", "seasonId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityGrant_accountId_id_key" ON "CapabilityGrant"("accountId", "id");

-- CreateIndex
CREATE INDEX "Team_accountId_status_idx" ON "Team"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Team_accountId_id_key" ON "Team"("accountId", "id");

-- CreateIndex
CREATE INDEX "Season_accountId_status_idx" ON "Season"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Season_accountId_id_key" ON "Season"("accountId", "id");

-- CreateIndex
CREATE INDEX "TeamSeason_accountId_teamId_idx" ON "TeamSeason"("accountId", "teamId");

-- CreateIndex
CREATE INDEX "TeamSeason_accountId_seasonId_idx" ON "TeamSeason"("accountId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeason_accountId_teamId_seasonId_key" ON "TeamSeason"("accountId", "teamId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeason_accountId_id_key" ON "TeamSeason"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeason_accountId_seasonId_id_key" ON "TeamSeason"("accountId", "seasonId", "id");

-- CreateIndex
CREATE INDEX "Player_accountId_archivedAt_idx" ON "Player"("accountId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Player_accountId_id_key" ON "Player"("accountId", "id");

-- CreateIndex
CREATE INDEX "RosterEntry_accountId_teamSeasonId_status_idx" ON "RosterEntry"("accountId", "teamSeasonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RosterEntry_accountId_teamSeasonId_playerId_key" ON "RosterEntry"("accountId", "teamSeasonId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterEntry_accountId_id_key" ON "RosterEntry"("accountId", "id");

-- CreateIndex
CREATE INDEX "RulesetVersion_accountId_status_idx" ON "RulesetVersion"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RulesetVersion_accountId_name_version_key" ON "RulesetVersion"("accountId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RulesetVersion_accountId_id_key" ON "RulesetVersion"("accountId", "id");

-- CreateIndex
CREATE INDEX "Game_accountId_seasonId_status_idx" ON "Game"("accountId", "seasonId", "status");

-- CreateIndex
CREATE INDEX "Game_accountId_teamSeasonId_scheduledAt_idx" ON "Game"("accountId", "teamSeasonId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Game_accountId_id_key" ON "Game"("accountId", "id");

-- CreateIndex
CREATE INDEX "GameTeamSnapshot_accountId_teamId_idx" ON "GameTeamSnapshot"("accountId", "teamId");

-- CreateIndex
CREATE INDEX "GameTeamSnapshot_accountId_teamSeasonId_idx" ON "GameTeamSnapshot"("accountId", "teamSeasonId");

-- CreateIndex
CREATE UNIQUE INDEX "GameTeamSnapshot_accountId_id_key" ON "GameTeamSnapshot"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GameTeamSnapshot_accountId_gameId_id_key" ON "GameTeamSnapshot"("accountId", "gameId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GameTeamSnapshot_gameId_side_key" ON "GameTeamSnapshot"("gameId", "side");

-- CreateIndex
CREATE INDEX "GameSetupSnapshot_accountId_rulesetVersionId_idx" ON "GameSetupSnapshot"("accountId", "rulesetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSetupSnapshot_accountId_id_key" ON "GameSetupSnapshot"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GameSetupSnapshot_gameId_setupRevision_key" ON "GameSetupSnapshot"("gameId", "setupRevision");

-- CreateIndex
CREATE UNIQUE INDEX "GameSetupSnapshot_accountId_gameId_id_key" ON "GameSetupSnapshot"("accountId", "gameId", "id");

-- CreateIndex
CREATE INDEX "LineupSlotSnapshot_accountId_playerId_idx" ON "LineupSlotSnapshot"("accountId", "playerId");

-- CreateIndex
CREATE INDEX "LineupSlotSnapshot_accountId_rosterEntryId_idx" ON "LineupSlotSnapshot"("accountId", "rosterEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "LineupSlotSnapshot_accountId_id_key" ON "LineupSlotSnapshot"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LineupSlotSnapshot_setupSnapshotId_gameTeamSnapshotId_batti_key" ON "LineupSlotSnapshot"("setupSnapshotId", "gameTeamSnapshotId", "battingOrder");

-- CreateIndex
CREATE INDEX "PlayTransaction_accountId_gameId_acceptedAt_idx" ON "PlayTransaction"("accountId", "gameId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayTransaction_accountId_id_key" ON "PlayTransaction"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PlayTransaction_accountId_gameId_id_key" ON "PlayTransaction"("accountId", "gameId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PlayTransaction_gameId_acceptedRevision_key" ON "PlayTransaction"("gameId", "acceptedRevision");

-- CreateIndex
CREATE UNIQUE INDEX "PlayTransaction_accountId_gameId_actorId_clientSubmissionId_key" ON "PlayTransaction"("accountId", "gameId", "actorId", "clientSubmissionId");

-- CreateIndex
CREATE INDEX "SourceEvent_accountId_gameId_recordedAt_idx" ON "SourceEvent"("accountId", "gameId", "recordedAt");

-- CreateIndex
CREATE INDEX "SourceEvent_accountId_rulesetVersionId_idx" ON "SourceEvent"("accountId", "rulesetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEvent_accountId_id_key" ON "SourceEvent"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEvent_accountId_gameId_id_key" ON "SourceEvent"("accountId", "gameId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEvent_gameId_sequence_key" ON "SourceEvent"("gameId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEvent_playTransactionId_componentOrder_key" ON "SourceEvent"("playTransactionId", "componentOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EventSupersession_accountId_id_key" ON "EventSupersession"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EventSupersession_accountId_gameId_supersededEventId_key" ON "EventSupersession"("accountId", "gameId", "supersededEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventSupersession_accountId_gameId_replacementEventId_super_key" ON "EventSupersession"("accountId", "gameId", "replacementEventId", "supersededEventId");

-- CreateIndex
CREATE INDEX "ProjectionCheckpoint_accountId_scope_status_idx" ON "ProjectionCheckpoint"("accountId", "scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectionCheckpoint_accountId_id_key" ON "ProjectionCheckpoint"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectionCheckpoint_accountId_gameId_sourceRevision_deriva_key" ON "ProjectionCheckpoint"("accountId", "gameId", "sourceRevision", "derivationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectionCheckpoint_accountId_seasonId_sourceRevision_deri_key" ON "ProjectionCheckpoint"("accountId", "seasonId", "sourceRevision", "derivationVersion");

-- CreateIndex
CREATE INDEX "SecurityAuditRecord_accountId_createdAt_idx" ON "SecurityAuditRecord"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditRecord_accountId_targetType_targetId_idx" ON "SecurityAuditRecord"("accountId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "SecurityAuditRecord_correlationId_idx" ON "SecurityAuditRecord"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAuditRecord_accountId_id_key" ON "SecurityAuditRecord"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyOverlay_accountId_id_key" ON "PrivacyOverlay"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyOverlay_accountId_effectiveOrder_key" ON "PrivacyOverlay"("accountId", "effectiveOrder");

-- CreateIndex
CREATE INDEX "PrivacyOverlayField_accountId_playerId_idx" ON "PrivacyOverlayField"("accountId", "playerId");

-- CreateIndex
CREATE INDEX "PrivacyOverlayField_accountId_lineupSlotSnapshotId_idx" ON "PrivacyOverlayField"("accountId", "lineupSlotSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyOverlayField_accountId_id_key" ON "PrivacyOverlayField"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyOverlayField_privacyOverlayId_playerId_lineupSlotSna_key" ON "PrivacyOverlayField"("privacyOverlayId", "playerId", "lineupSlotSnapshotId", "field");

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRoleAssignment" ADD CONSTRAINT "MembershipRoleAssignment_accountId_membershipId_fkey" FOREIGN KEY ("accountId", "membershipId") REFERENCES "AccountMembership"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRoleAssignment" ADD CONSTRAINT "MembershipRoleAssignment_accountId_teamId_fkey" FOREIGN KEY ("accountId", "teamId") REFERENCES "Team"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRoleAssignment" ADD CONSTRAINT "MembershipRoleAssignment_accountId_seasonId_fkey" FOREIGN KEY ("accountId", "seasonId") REFERENCES "Season"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRoleAssignment" ADD CONSTRAINT "MembershipRoleAssignment_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_accountId_membershipId_fkey" FOREIGN KEY ("accountId", "membershipId") REFERENCES "AccountMembership"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_accountId_teamId_fkey" FOREIGN KEY ("accountId", "teamId") REFERENCES "Team"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_accountId_seasonId_fkey" FOREIGN KEY ("accountId", "seasonId") REFERENCES "Season"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeason" ADD CONSTRAINT "TeamSeason_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeason" ADD CONSTRAINT "TeamSeason_accountId_teamId_fkey" FOREIGN KEY ("accountId", "teamId") REFERENCES "Team"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeason" ADD CONSTRAINT "TeamSeason_accountId_seasonId_fkey" FOREIGN KEY ("accountId", "seasonId") REFERENCES "Season"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_accountId_playerId_fkey" FOREIGN KEY ("accountId", "playerId") REFERENCES "Player"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_accountId_teamSeasonId_fkey" FOREIGN KEY ("accountId", "teamSeasonId") REFERENCES "TeamSeason"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulesetVersion" ADD CONSTRAINT "RulesetVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_accountId_seasonId_fkey" FOREIGN KEY ("accountId", "seasonId") REFERENCES "Season"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_accountId_seasonId_teamSeasonId_fkey" FOREIGN KEY ("accountId", "seasonId", "teamSeasonId") REFERENCES "TeamSeason"("accountId", "seasonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTeamSnapshot" ADD CONSTRAINT "GameTeamSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTeamSnapshot" ADD CONSTRAINT "GameTeamSnapshot_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTeamSnapshot" ADD CONSTRAINT "GameTeamSnapshot_accountId_teamId_fkey" FOREIGN KEY ("accountId", "teamId") REFERENCES "Team"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTeamSnapshot" ADD CONSTRAINT "GameTeamSnapshot_accountId_teamSeasonId_fkey" FOREIGN KEY ("accountId", "teamSeasonId") REFERENCES "TeamSeason"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSetupSnapshot" ADD CONSTRAINT "GameSetupSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSetupSnapshot" ADD CONSTRAINT "GameSetupSnapshot_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSetupSnapshot" ADD CONSTRAINT "GameSetupSnapshot_accountId_rulesetVersionId_fkey" FOREIGN KEY ("accountId", "rulesetVersionId") REFERENCES "RulesetVersion"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSlotSnapshot" ADD CONSTRAINT "LineupSlotSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSlotSnapshot" ADD CONSTRAINT "LineupSlotSnapshot_accountId_gameId_setupSnapshotId_fkey" FOREIGN KEY ("accountId", "gameId", "setupSnapshotId") REFERENCES "GameSetupSnapshot"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSlotSnapshot" ADD CONSTRAINT "LineupSlotSnapshot_accountId_gameId_gameTeamSnapshotId_fkey" FOREIGN KEY ("accountId", "gameId", "gameTeamSnapshotId") REFERENCES "GameTeamSnapshot"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSlotSnapshot" ADD CONSTRAINT "LineupSlotSnapshot_accountId_playerId_fkey" FOREIGN KEY ("accountId", "playerId") REFERENCES "Player"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupSlotSnapshot" ADD CONSTRAINT "LineupSlotSnapshot_accountId_rosterEntryId_fkey" FOREIGN KEY ("accountId", "rosterEntryId") REFERENCES "RosterEntry"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayTransaction" ADD CONSTRAINT "PlayTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayTransaction" ADD CONSTRAINT "PlayTransaction_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayTransaction" ADD CONSTRAINT "PlayTransaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvent" ADD CONSTRAINT "SourceEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvent" ADD CONSTRAINT "SourceEvent_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvent" ADD CONSTRAINT "SourceEvent_accountId_gameId_playTransactionId_fkey" FOREIGN KEY ("accountId", "gameId", "playTransactionId") REFERENCES "PlayTransaction"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvent" ADD CONSTRAINT "SourceEvent_accountId_rulesetVersionId_fkey" FOREIGN KEY ("accountId", "rulesetVersionId") REFERENCES "RulesetVersion"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvent" ADD CONSTRAINT "SourceEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSupersession" ADD CONSTRAINT "EventSupersession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSupersession" ADD CONSTRAINT "EventSupersession_accountId_gameId_supersededEventId_fkey" FOREIGN KEY ("accountId", "gameId", "supersededEventId") REFERENCES "SourceEvent"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSupersession" ADD CONSTRAINT "EventSupersession_accountId_gameId_replacementEventId_fkey" FOREIGN KEY ("accountId", "gameId", "replacementEventId") REFERENCES "SourceEvent"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionCheckpoint" ADD CONSTRAINT "ProjectionCheckpoint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionCheckpoint" ADD CONSTRAINT "ProjectionCheckpoint_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionCheckpoint" ADD CONSTRAINT "ProjectionCheckpoint_accountId_seasonId_fkey" FOREIGN KEY ("accountId", "seasonId") REFERENCES "Season"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAuditRecord" ADD CONSTRAINT "SecurityAuditRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAuditRecord" ADD CONSTRAINT "SecurityAuditRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyOverlay" ADD CONSTRAINT "PrivacyOverlay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyOverlay" ADD CONSTRAINT "PrivacyOverlay_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyOverlayField" ADD CONSTRAINT "PrivacyOverlayField_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyOverlayField" ADD CONSTRAINT "PrivacyOverlayField_accountId_privacyOverlayId_fkey" FOREIGN KEY ("accountId", "privacyOverlayId") REFERENCES "PrivacyOverlay"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyOverlayField" ADD CONSTRAINT "PrivacyOverlayField_accountId_playerId_fkey" FOREIGN KEY ("accountId", "playerId") REFERENCES "Player"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyOverlayField" ADD CONSTRAINT "PrivacyOverlayField_accountId_lineupSlotSnapshotId_fkey" FOREIGN KEY ("accountId", "lineupSlotSnapshotId") REFERENCES "LineupSlotSnapshot"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express partial uniqueness or cross-column shape checks. These
-- database constraints keep tenant scope and append-only records correct even
-- when a future caller bypasses the application service layer.
ALTER TABLE "Season" ADD CONSTRAINT "Season_date_range_check"
  CHECK ("endsOn" IS NULL OR "startsOn" IS NULL OR "endsOn" >= "startsOn");

ALTER TABLE "Game" ADD CONSTRAINT "Game_revision_nonnegative_check"
  CHECK ("revision" >= 0);

ALTER TABLE "PlayTransaction" ADD CONSTRAINT "PlayTransaction_revision_check"
  CHECK ("acceptedRevision" > 0 AND "expectedRevision" >= 0);

ALTER TABLE "SourceEvent" ADD CONSTRAINT "SourceEvent_shape_check"
  CHECK (
    "sequence" > 0 AND "schemaVersion" > 0 AND
    (("playTransactionId" IS NULL AND "componentOrder" IS NULL) OR
      ("playTransactionId" IS NOT NULL AND "componentOrder" >= 0))
  );

ALTER TABLE "EventSupersession" ADD CONSTRAINT "EventSupersession_distinct_events_check"
  CHECK ("supersededEventId" <> "replacementEventId");

ALTER TABLE "MembershipRoleAssignment" ADD CONSTRAINT "MembershipRoleAssignment_scope_check"
  CHECK (
    ("scope" = 'ACCOUNT' AND "teamId" IS NULL AND "seasonId" IS NULL AND "gameId" IS NULL) OR
    ("scope" = 'TEAM' AND "teamId" IS NOT NULL AND "seasonId" IS NULL AND "gameId" IS NULL) OR
    ("scope" = 'SEASON' AND "teamId" IS NULL AND "seasonId" IS NOT NULL AND "gameId" IS NULL) OR
    ("scope" = 'GAME' AND "teamId" IS NULL AND "seasonId" IS NULL AND "gameId" IS NOT NULL)
  );

ALTER TABLE "CapabilityGrant" ADD CONSTRAINT "CapabilityGrant_scope_check"
  CHECK (
    ("scope" = 'ACCOUNT' AND "teamId" IS NULL AND "seasonId" IS NULL AND "gameId" IS NULL) OR
    ("scope" = 'TEAM' AND "teamId" IS NOT NULL AND "seasonId" IS NULL AND "gameId" IS NULL) OR
    ("scope" = 'SEASON' AND "teamId" IS NULL AND "seasonId" IS NOT NULL AND "gameId" IS NULL) OR
    ("scope" = 'GAME' AND "teamId" IS NULL AND "seasonId" IS NULL AND "gameId" IS NOT NULL)
  );

ALTER TABLE "GameTeamSnapshot" ADD CONSTRAINT "GameTeamSnapshot_account_team_check"
  CHECK (
    ("isAccountTeam" AND "teamId" IS NOT NULL AND "teamSeasonId" IS NOT NULL) OR
    (NOT "isAccountTeam" AND "teamId" IS NULL AND "teamSeasonId" IS NULL)
  );

ALTER TABLE "ProjectionCheckpoint" ADD CONSTRAINT "ProjectionCheckpoint_scope_check"
  CHECK (
    ("scope" = 'GAME' AND "gameId" IS NOT NULL AND "seasonId" IS NULL) OR
    ("scope" = 'SEASON' AND "gameId" IS NULL AND "seasonId" IS NOT NULL)
  );

ALTER TABLE "PrivacyOverlayField" ADD CONSTRAINT "PrivacyOverlayField_target_check"
  CHECK (("playerId" IS NOT NULL)::integer + ("lineupSlotSnapshotId" IS NOT NULL)::integer = 1);

CREATE UNIQUE INDEX "Team_active_account_display_name_key"
  ON "Team"("accountId", "displayName") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "RosterEntry_active_team_season_jersey_number_key"
  ON "RosterEntry"("teamSeasonId", "jerseyNumber")
  WHERE "status" = 'ACTIVE' AND "jerseyNumber" IS NOT NULL;
CREATE UNIQUE INDEX "MembershipRoleAssignment_active_scope_key"
  ON "MembershipRoleAssignment"("accountId", "membershipId", "role", "scope", COALESCE("teamId", ''), COALESCE("seasonId", ''), COALESCE("gameId", ''))
  WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "CapabilityGrant_active_scope_key"
  ON "CapabilityGrant"("accountId", "membershipId", "capability", "scope", COALESCE("teamId", ''), COALESCE("seasonId", ''), COALESCE("gameId", ''))
  WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "ProjectionCheckpoint_game_revision_key"
  ON "ProjectionCheckpoint"("accountId", "gameId", "sourceRevision", "derivationVersion")
  WHERE "scope" = 'GAME';
CREATE UNIQUE INDEX "ProjectionCheckpoint_season_revision_key"
  ON "ProjectionCheckpoint"("accountId", "seasonId", "sourceRevision", "derivationVersion")
  WHERE "scope" = 'SEASON';
CREATE UNIQUE INDEX "PrivacyOverlayField_player_field_key"
  ON "PrivacyOverlayField"("privacyOverlayId", "playerId", "field") WHERE "playerId" IS NOT NULL;
CREATE UNIQUE INDEX "PrivacyOverlayField_snapshot_field_key"
  ON "PrivacyOverlayField"("privacyOverlayId", "lineupSlotSnapshotId", "field") WHERE "lineupSlotSnapshotId" IS NOT NULL;

CREATE FUNCTION "prevent_append_only_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GameTeamSnapshot_append_only" BEFORE UPDATE OR DELETE ON "GameTeamSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "GameSetupSnapshot_append_only" BEFORE UPDATE OR DELETE ON "GameSetupSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "LineupSlotSnapshot_append_only" BEFORE UPDATE OR DELETE ON "LineupSlotSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "PlayTransaction_append_only" BEFORE UPDATE OR DELETE ON "PlayTransaction"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "SourceEvent_append_only" BEFORE UPDATE OR DELETE ON "SourceEvent"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "EventSupersession_append_only" BEFORE UPDATE OR DELETE ON "EventSupersession"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "SecurityAuditRecord_append_only" BEFORE UPDATE OR DELETE ON "SecurityAuditRecord"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "PrivacyOverlay_append_only" BEFORE UPDATE OR DELETE ON "PrivacyOverlay"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
CREATE TRIGGER "PrivacyOverlayField_append_only" BEFORE UPDATE OR DELETE ON "PrivacyOverlayField"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

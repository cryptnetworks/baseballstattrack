import { createHash } from "node:crypto";

import { canonicalJson } from "@/domain/events/event-log";
import {
  assertFantasyAuthority,
  type FantasyDomainAuthority,
  type FantasyLeague,
  type FantasyRosterSnapshot,
  type FantasyTeam,
} from "@/domain/fantasy-domain";
import {
  scoreFantasyStatistics,
  verifyFantasyScoringModel,
  type FantasyScore,
  type FantasyScoringModelVersion,
  type FantasyStatisticSnapshot,
} from "@/domain/fantasy-rules";

export const FANTASY_SCORING_CONTRACT_VERSION = 1 as const;
export const FANTASY_SCORING_CALCULATION_VERSION = 1 as const;

export type FantasyScoringErrorCode =
  | "INVALID_INPUT"
  | "AUTHORIZATION_REQUIRED"
  | "ACCOUNT_MISMATCH"
  | "LEAGUE_MISMATCH"
  | "RULES_MISMATCH"
  | "ROSTER_MISMATCH"
  | "PERIOD_INVALID"
  | "SOURCE_CONFLICT"
  | "RESULT_NOT_READY"
  | "REVISION_CONFLICT"
  | "MATCHUP_INVALID"
  | "STANDINGS_INVALID"
  | "UNSAFE_ARITHMETIC";

export class FantasyScoringError extends Error {
  constructor(
    readonly code: FantasyScoringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FantasyScoringError";
  }
}

export type FantasyScoringPeriod = Readonly<{
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  sequence: number;
  phase: "REGULAR_SEASON" | "PLAYOFF" | "CHAMPIONSHIP";
  startsAt: string;
  endsAt: string;
  finalizationDeadline: string;
}>;

export type FantasyStatisticAvailability =
  | "FINAL_VERIFIED"
  | "CORRECTED_FINAL"
  | "INCOMPLETE_GAME"
  | "UNVERIFIED"
  | "INSUFFICIENT_SAMPLE";

export type FantasyPlayerPeriodStatistics = Readonly<{
  accountId: string;
  fantasyLeagueId: string;
  fantasyTeamId: string;
  periodId: string;
  rosterSnapshotId: string;
  rosterSlotId: string;
  fantasyPlayerEntryId: string;
  availability: FantasyStatisticAvailability;
  expectedGames: number;
  completedGames: number;
  projectedCompletionAt: string | null;
  snapshot: FantasyStatisticSnapshot | null;
}>;

export type FantasyScoringUncertaintyCode =
  | "EMPTY_LINEUP_SLOT"
  | "MISSING_STATISTICS"
  | "INCOMPLETE_GAME"
  | "UNVERIFIED_STATISTICS"
  | "INSUFFICIENT_SAMPLE";

export type FantasyScoringUncertainty = Readonly<{
  code: FantasyScoringUncertaintyCode;
  rosterSlotId: string;
  fantasyPlayerEntryId: string | null;
  expectedGames: number | null;
  completedGames: number | null;
  projectedCompletionAt: string | null;
}>;

export type FantasyCategoryTotal = Readonly<{
  categoryId: string;
  sourceStatistic: string;
  units: number;
  milliPoints: number;
}>;

export type FantasyScoredSource = Readonly<{
  rosterSlotId: string;
  fantasyPlayerEntryId: string;
  availability: FantasyStatisticAvailability;
  expectedGames: number;
  completedGames: number;
  projectedCompletionAt: string | null;
  score: FantasyScore | null;
  statisticLineage: FantasyStatisticSnapshot["lineage"] | null;
}>;

export type FantasyCalculationAudit = Readonly<{
  id: string;
  actorId: string;
  authoritySource: FantasyDomainAuthority["source"];
  authorityReferenceIds: readonly string[];
  capability: "fantasy.scoring.calculate";
  accountId: string;
  fantasyLeagueId: string;
  targetKind: "TEAM_PERIOD" | "MATCHUP" | "STANDINGS";
  targetId: string;
  teamIds: readonly string[];
  periodId: string | null;
  action: "CALCULATE" | "RECALCULATE" | "FINALIZE";
  acceptedAt: string;
  revision: number;
  previousResultId: string | null;
  correctionReason: string | null;
}>;

export type FantasyResultLineage = Readonly<{
  fantasyModelId: string;
  fantasyModelVersionId: string;
  fantasyModelVersion: number;
  fantasyModelDigest: string;
  baseballRulesetVersionIds: readonly string[];
  statisticDerivationVersions: readonly number[];
  statisticRulesVersions: readonly number[];
  sourceRevisions: readonly number[];
  correctionRevisions: readonly number[];
}>;

export type FantasyTeamPeriodResult = Readonly<{
  contractVersion: typeof FANTASY_SCORING_CONTRACT_VERSION;
  calculationVersion: typeof FANTASY_SCORING_CALCULATION_VERSION;
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  fantasyTeamId: string;
  period: FantasyScoringPeriod;
  rosterSnapshotId: string;
  rosterSnapshotRevision: number;
  status: "IN_PROGRESS" | "AWAITING_FINAL_DATA" | "READY" | "FINAL";
  totalMilliPoints: number;
  categoryTotals: readonly FantasyCategoryTotal[];
  expectedSourceCount: number;
  completedSourceCount: number;
  projectedCompletionAt: string | null;
  uncertainties: readonly FantasyScoringUncertainty[];
  sources: readonly FantasyScoredSource[];
  lineage: FantasyResultLineage;
  calculatedAt: string;
  finalizedAt: string | null;
  revision: number;
  previousResultId: string | null;
  correction: Readonly<{
    reason: string;
    previousResultId: string;
    previousResultDigest: string;
  }> | null;
  sourceDigest: string;
  resultDigest: string;
  audit: FantasyCalculationAudit;
}>;

export type FantasyTeamPeriodCalculationInput = Readonly<{
  resultId: string;
  auditId: string;
  accountId: string;
  fantasyLeagueId: string;
  fantasyTeamId: string;
  period: FantasyScoringPeriod;
  calculatedAt: string;
  finalize: boolean;
  revision: number;
  previousResultId: string | null;
  correctionReason: string | null;
  statistics: readonly FantasyPlayerPeriodStatistics[];
}>;

export type FantasyMatchupTeamTotal = Readonly<{
  fantasyTeamId: string;
  totalMilliPoints: number;
  categoryTotals: readonly FantasyCategoryTotal[];
  teamResultId: string;
  teamResultRevision: number;
  teamResultDigest: string;
}>;

export type FantasyMatchupResult = Readonly<{
  contractVersion: typeof FANTASY_SCORING_CONTRACT_VERSION;
  calculationVersion: typeof FANTASY_SCORING_CALCULATION_VERSION;
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  period: FantasyScoringPeriod;
  status: "IN_PROGRESS" | "FINAL";
  first: FantasyMatchupTeamTotal;
  second: FantasyMatchupTeamTotal;
  outcome: "UNRESOLVED" | "FIRST_WIN" | "SECOND_WIN" | "TIE";
  winnerTeamId: string | null;
  loserTeamId: string | null;
  tieBreak: "NONE" | "HIGHER_PREDECLARED_SEED";
  firstPredeclaredSeed: number;
  secondPredeclaredSeed: number;
  lineage: FantasyResultLineage;
  calculatedAt: string;
  revision: number;
  previousResultId: string | null;
  correction: Readonly<{
    reason: string;
    previousResultId: string;
    previousResultDigest: string;
  }> | null;
  sourceDigest: string;
  resultDigest: string;
  audit: FantasyCalculationAudit;
}>;

export type FantasyMatchupCalculationInput = Readonly<{
  resultId: string;
  auditId: string;
  accountId: string;
  fantasyLeagueId: string;
  calculatedAt: string;
  revision: number;
  previousResultId: string | null;
  correctionReason: string | null;
  firstPredeclaredSeed: number;
  secondPredeclaredSeed: number;
}>;

export type FantasyStandingTeam = Readonly<{
  fantasyTeamId: string;
  predeclaredSeed: number;
}>;

export type FantasyStandingRecord = Readonly<{
  rank: number;
  fantasyTeamId: string;
  predeclaredSeed: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  standingPoints: number;
  pointsForMilli: number;
  pointsAgainstMilli: number;
  pointsDifferentialMilli: number;
  categoryTotals: readonly FantasyCategoryTotal[];
  currentStreak: string;
  playoffQualification: "QUALIFIED" | "CURRENT_CUTOFF" | "NOT_QUALIFIED";
}>;

export type FantasyStandingsResult = Readonly<{
  contractVersion: typeof FANTASY_SCORING_CONTRACT_VERSION;
  calculationVersion: typeof FANTASY_SCORING_CALCULATION_VERSION;
  id: string;
  accountId: string;
  fantasyLeagueId: string;
  status: "IN_PROGRESS" | "FINAL";
  throughPeriodSequence: number;
  playoffTeamCount: number;
  completedMatchupCount: number;
  pendingMatchupCount: number;
  records: readonly FantasyStandingRecord[];
  sourceMatchups: readonly Readonly<{
    id: string;
    revision: number;
    digest: string;
  }>[];
  lineage: FantasyResultLineage;
  calculatedAt: string;
  revision: number;
  previousResultId: string | null;
  correction: Readonly<{
    reason: string;
    previousResultId: string;
    previousResultDigest: string;
  }> | null;
  sourceDigest: string;
  resultDigest: string;
  audit: FantasyCalculationAudit;
}>;

export type FantasyStandingsCalculationInput = Readonly<{
  resultId: string;
  auditId: string;
  accountId: string;
  fantasyLeagueId: string;
  calculatedAt: string;
  revision: number;
  previousResultId: string | null;
  correctionReason: string | null;
  regularSeasonComplete: boolean;
  playoffTeamCount: number;
  teams: readonly FantasyStandingTeam[];
}>;

function scoringError(code: FantasyScoringErrorCode, message: string): never {
  throw new FantasyScoringError(code, message);
}

function stableId(value: string, label: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > 128) {
    scoringError("INVALID_INPUT", `${label} must be a stable identifier.`);
  }
}

function canonicalInstant(value: string, label: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    scoringError("INVALID_INPUT", `${label} must be a canonical UTC instant.`);
  }
  return time;
}

function nonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    scoringError(
      "INVALID_INPUT",
      `${label} must be a nonnegative safe integer.`,
    );
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    scoringError("INVALID_INPUT", `${label} must be a positive safe integer.`);
  }
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    scoringError("UNSAFE_ARITHMETIC", "Fantasy total exceeds safe arithmetic.");
  }
  return value;
}

function safeDifference(left: number, right: number): number {
  const value = left - right;
  if (!Number.isSafeInteger(value)) {
    scoringError(
      "UNSAFE_ARITHMETIC",
      "Fantasy difference exceeds safe arithmetic.",
    );
  }
  return value;
}

function compareStableIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNumbersAscending(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNumbersDescending(left: number, right: number): number {
  return compareNumbersAscending(right, left);
}

function digest(value: unknown): string {
  return `sha256:v1:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function periodEnvelope(period: FantasyScoringPeriod) {
  return {
    id: period.id,
    accountId: period.accountId,
    fantasyLeagueId: period.fantasyLeagueId,
    sequence: period.sequence,
    phase: period.phase,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    finalizationDeadline: period.finalizationDeadline,
  };
}

function validatePeriod(period: FantasyScoringPeriod): void {
  stableId(period.id, "Period id");
  stableId(period.accountId, "Period Account id");
  stableId(period.fantasyLeagueId, "Period league id");
  positiveInteger(period.sequence, "Period sequence");
  if (!["REGULAR_SEASON", "PLAYOFF", "CHAMPIONSHIP"].includes(period.phase)) {
    scoringError("PERIOD_INVALID", "Fantasy scoring period phase is invalid.");
  }
  const startsAt = canonicalInstant(period.startsAt, "Period start");
  const endsAt = canonicalInstant(period.endsAt, "Period end");
  const deadline = canonicalInstant(
    period.finalizationDeadline,
    "Finalization deadline",
  );
  if (startsAt >= endsAt || endsAt > deadline) {
    scoringError(
      "PERIOD_INVALID",
      "Fantasy period requires ordered start, end, and finalization instants.",
    );
  }
}

function samePeriod(
  left: FantasyScoringPeriod,
  right: FantasyScoringPeriod,
): boolean {
  return (
    canonicalJson(periodEnvelope(left)) === canonicalJson(periodEnvelope(right))
  );
}

function rulesMatch(
  league: FantasyLeague,
  roster: FantasyRosterSnapshot,
  model: FantasyScoringModelVersion,
): boolean {
  return (
    league.rules.modelId === model.modelId &&
    league.rules.modelVersionId === model.modelVersionId &&
    league.rules.modelVersion === model.version &&
    league.rules.modelDigest === model.contentDigest &&
    league.rules.statisticRegistryVersion === model.statisticRegistryVersion &&
    roster.rules.modelVersionId === model.modelVersionId &&
    roster.rules.modelDigest === model.contentDigest
  );
}

function validateScoringAuthority(
  authority: FantasyDomainAuthority,
  accountId: string,
  fantasyLeagueId: string,
): void {
  try {
    assertFantasyAuthority(
      authority,
      accountId,
      "fantasy.scoring.calculate",
      fantasyLeagueId,
    );
  } catch {
    scoringError(
      "AUTHORIZATION_REQUIRED",
      "Fantasy scoring requires exact Account and league authority.",
    );
  }
}

function cloneStatisticLineage(
  lineage: FantasyStatisticSnapshot["lineage"],
): FantasyStatisticSnapshot["lineage"] {
  return Object.freeze({
    ...lineage,
    baseballRulesetVersionIds: Object.freeze([
      ...lineage.baseballRulesetVersionIds,
    ]),
  });
}

function cloneCategoryTotals(
  categories: readonly FantasyCategoryTotal[],
): readonly FantasyCategoryTotal[] {
  return Object.freeze(
    categories.map((category) => Object.freeze({ ...category })),
  );
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
  return Object.freeze(
    [...new Set(values)].sort((left, right) => left - right),
  );
}

function aggregateResultLineage(
  lineages: readonly FantasyResultLineage[],
  mismatchCode: "MATCHUP_INVALID" | "STANDINGS_INVALID",
): FantasyResultLineage {
  const first = lineages[0];
  if (!first) {
    scoringError(
      mismatchCode,
      "A fantasy aggregate requires at least one versioned source result.",
    );
  }
  if (
    lineages.some(
      (lineage) =>
        lineage.fantasyModelId !== first.fantasyModelId ||
        lineage.fantasyModelVersionId !== first.fantasyModelVersionId ||
        lineage.fantasyModelVersion !== first.fantasyModelVersion ||
        lineage.fantasyModelDigest !== first.fantasyModelDigest,
    )
  ) {
    scoringError(
      mismatchCode,
      "Fantasy source results must use one exact scoring model version and digest.",
    );
  }
  return Object.freeze({
    fantasyModelId: first.fantasyModelId,
    fantasyModelVersionId: first.fantasyModelVersionId,
    fantasyModelVersion: first.fantasyModelVersion,
    fantasyModelDigest: first.fantasyModelDigest,
    baseballRulesetVersionIds: uniqueSortedStrings(
      lineages.flatMap((lineage) => lineage.baseballRulesetVersionIds),
    ),
    statisticDerivationVersions: uniqueSortedNumbers(
      lineages.flatMap((lineage) => lineage.statisticDerivationVersions),
    ),
    statisticRulesVersions: uniqueSortedNumbers(
      lineages.flatMap((lineage) => lineage.statisticRulesVersions),
    ),
    sourceRevisions: uniqueSortedNumbers(
      lineages.flatMap((lineage) => lineage.sourceRevisions),
    ),
    correctionRevisions: uniqueSortedNumbers(
      lineages.flatMap((lineage) => lineage.correctionRevisions),
    ),
  });
}

function sameFantasyModelLineage(
  left: FantasyResultLineage,
  right: FantasyResultLineage,
): boolean {
  return (
    left.fantasyModelId === right.fantasyModelId &&
    left.fantasyModelVersionId === right.fantasyModelVersionId &&
    left.fantasyModelVersion === right.fantasyModelVersion &&
    left.fantasyModelDigest === right.fantasyModelDigest
  );
}

function revisionDecision(
  identity: Readonly<{
    id: string;
    revision: number;
    previousResultId: string | null;
    correctionReason: string | null;
    calculatedAt: string;
  }>,
  sourceDigest: string,
  status: string,
  previous: Readonly<{
    id: string;
    revision: number;
    previousResultId: string | null;
    sourceDigest: string;
    resultDigest: string;
    calculatedAt: string;
    status: string;
  }> | null,
): Readonly<{
  action: FantasyCalculationAudit["action"];
  correction: {
    reason: string;
    previousResultId: string;
    previousResultDigest: string;
  } | null;
}> {
  stableId(identity.id, "Result id");
  nonnegativeInteger(identity.revision, "Result revision");
  const calculatedAt = canonicalInstant(
    identity.calculatedAt,
    "Calculation time",
  );
  if (previous === null) {
    if (
      identity.revision !== 0 ||
      identity.previousResultId !== null ||
      identity.correctionReason !== null
    ) {
      scoringError(
        "REVISION_CONFLICT",
        "An initial fantasy result must begin at revision zero without a predecessor.",
      );
    }
    return Object.freeze({
      action: status === "FINAL" ? "FINALIZE" : "CALCULATE",
      correction: null,
    });
  }
  if (
    identity.id === previous.id ||
    identity.revision !== previous.revision + 1 ||
    identity.previousResultId !== previous.id ||
    calculatedAt <= Date.parse(previous.calculatedAt)
  ) {
    scoringError(
      "REVISION_CONFLICT",
      "Fantasy result revisions require a new id and ordered exact predecessor.",
    );
  }
  const sourceChanged = sourceDigest !== previous.sourceDigest;
  const finalizing = previous.status !== "FINAL" && status === "FINAL";
  const statusChanged = previous.status !== status;
  if (!sourceChanged && !statusChanged) {
    scoringError(
      "REVISION_CONFLICT",
      "A new fantasy result revision requires changed sources or finalization.",
    );
  }
  if (sourceChanged && previous.status === "FINAL") {
    if (
      identity.correctionReason === null ||
      identity.correctionReason.trim().length === 0
    ) {
      scoringError(
        "REVISION_CONFLICT",
        "A source-driven fantasy recalculation requires an explicit correction reason.",
      );
    }
    return Object.freeze({
      action: "RECALCULATE",
      correction: Object.freeze({
        reason: identity.correctionReason.trim(),
        previousResultId: previous.id,
        previousResultDigest: previous.resultDigest,
      }),
    });
  }
  if (sourceChanged) {
    if (identity.correctionReason !== null) {
      scoringError(
        "REVISION_CONFLICT",
        "A provisional recalculation cannot claim a historical correction.",
      );
    }
    return Object.freeze({
      action: finalizing ? "FINALIZE" : "CALCULATE",
      correction: null,
    });
  }
  if (identity.correctionReason !== null) {
    scoringError(
      "REVISION_CONFLICT",
      "Finalization without source changes cannot claim a correction.",
    );
  }
  return Object.freeze({
    action: finalizing ? "FINALIZE" : "CALCULATE",
    correction: null,
  });
}

function calculationAudit(
  input: Readonly<{
    id: string;
    authority: FantasyDomainAuthority;
    accountId: string;
    fantasyLeagueId: string;
    targetKind: FantasyCalculationAudit["targetKind"];
    targetId: string;
    teamIds: readonly string[];
    periodId: string | null;
    action: FantasyCalculationAudit["action"];
    acceptedAt: string;
    revision: number;
    previousResultId: string | null;
    correctionReason: string | null;
  }>,
): FantasyCalculationAudit {
  stableId(input.id, "Audit id");
  return Object.freeze({
    id: input.id,
    actorId: input.authority.actorId,
    authoritySource: input.authority.source,
    authorityReferenceIds: Object.freeze([
      ...input.authority.authorityReferenceIds,
    ]),
    capability: "fantasy.scoring.calculate",
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    teamIds: Object.freeze([...input.teamIds]),
    periodId: input.periodId,
    action: input.action,
    acceptedAt: input.acceptedAt,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correctionReason: input.correctionReason,
  });
}

function availabilityUncertainty(
  source: FantasyPlayerPeriodStatistics,
): FantasyScoringUncertaintyCode | null {
  if (source.availability === "INCOMPLETE_GAME") return "INCOMPLETE_GAME";
  if (source.availability === "UNVERIFIED") return "UNVERIFIED_STATISTICS";
  if (source.availability === "INSUFFICIENT_SAMPLE") {
    return "INSUFFICIENT_SAMPLE";
  }
  return null;
}

export function calculateFantasyTeamPeriodResult(
  input: FantasyTeamPeriodCalculationInput,
  league: FantasyLeague,
  team: FantasyTeam,
  roster: FantasyRosterSnapshot,
  model: FantasyScoringModelVersion,
  authority: FantasyDomainAuthority,
  previous: FantasyTeamPeriodResult | null = null,
): FantasyTeamPeriodResult {
  stableId(input.resultId, "Team period result id");
  stableId(input.accountId, "Account id");
  stableId(input.fantasyLeagueId, "Fantasy league id");
  stableId(input.fantasyTeamId, "Fantasy team id");
  validateScoringAuthority(authority, input.accountId, input.fantasyLeagueId);
  validatePeriod(input.period);
  const calculatedAt = canonicalInstant(input.calculatedAt, "Calculation time");
  verifyFantasyScoringModel(model);

  if (
    input.accountId !== league.accountId ||
    input.accountId !== team.accountId ||
    input.accountId !== roster.accountId ||
    input.accountId !== input.period.accountId
  ) {
    scoringError(
      "ACCOUNT_MISMATCH",
      "Fantasy scoring crossed an Account boundary.",
    );
  }
  if (
    input.fantasyLeagueId !== league.id ||
    input.fantasyLeagueId !== team.fantasyLeagueId ||
    input.fantasyLeagueId !== roster.fantasyLeagueId ||
    input.fantasyLeagueId !== input.period.fantasyLeagueId ||
    input.fantasyTeamId !== team.id ||
    input.fantasyTeamId !== roster.fantasyTeamId
  ) {
    scoringError(
      "LEAGUE_MISMATCH",
      "Fantasy scoring ancestry does not match exactly.",
    );
  }
  if (
    !["ACTIVE", "COMPLETED"].includes(league.lifecycle) ||
    !["ACTIVE", "WITHDRAWN"].includes(team.lifecycle)
  ) {
    scoringError(
      "LEAGUE_MISMATCH",
      "Only active or completed fantasy history can be scored.",
    );
  }
  if (!rulesMatch(league, roster, model)) {
    scoringError(
      "RULES_MISMATCH",
      "Scoring must use the league's exact model binding.",
    );
  }

  const activeSlots = roster.slots.filter((slot) => slot.kind === "ACTIVE");
  const activeSlotIds = new Set(activeSlots.map((slot) => slot.id));
  const sourcesBySlot = new Map<string, FantasyPlayerPeriodStatistics>();
  for (const source of input.statistics) {
    stableId(source.rosterSlotId, "Source roster slot id");
    stableId(source.fantasyPlayerEntryId, "Source player entry id");
    nonnegativeInteger(source.expectedGames, "Expected games");
    nonnegativeInteger(source.completedGames, "Completed games");
    if (source.completedGames > source.expectedGames) {
      scoringError(
        "SOURCE_CONFLICT",
        "Completed games cannot exceed expected games.",
      );
    }
    if (source.projectedCompletionAt !== null) {
      canonicalInstant(source.projectedCompletionAt, "Projected completion");
    }
    if (
      source.accountId !== input.accountId ||
      source.fantasyLeagueId !== input.fantasyLeagueId ||
      source.fantasyTeamId !== input.fantasyTeamId ||
      source.periodId !== input.period.id ||
      source.rosterSnapshotId !== roster.id ||
      !activeSlotIds.has(source.rosterSlotId) ||
      sourcesBySlot.has(source.rosterSlotId)
    ) {
      scoringError(
        "SOURCE_CONFLICT",
        "Statistic sources must map once to an exact active lineup slot.",
      );
    }
    const slot = activeSlots.find(
      (candidate) => candidate.id === source.rosterSlotId,
    )!;
    if (
      slot.playerEntryId === null ||
      slot.playerEntryId !== source.fantasyPlayerEntryId
    ) {
      scoringError(
        "ROSTER_MISMATCH",
        "Statistic source player does not match the locked active roster slot.",
      );
    }
    const finalAvailability = ["FINAL_VERIFIED", "CORRECTED_FINAL"].includes(
      source.availability,
    );
    if (finalAvailability !== (source.snapshot !== null)) {
      scoringError(
        "SOURCE_CONFLICT",
        "Only final verified statistic sources may carry a scoring snapshot.",
      );
    }
    if (
      source.availability === "CORRECTED_FINAL" &&
      (source.snapshot?.lineage.correctionRevision ?? 0) < 1
    ) {
      scoringError(
        "SOURCE_CONFLICT",
        "Corrected statistics require a positive correction revision.",
      );
    }
    if (finalAvailability && source.completedGames !== source.expectedGames) {
      scoringError(
        "SOURCE_CONFLICT",
        "Final statistics require every expected game disposition to be complete.",
      );
    }
    sourcesBySlot.set(source.rosterSlotId, source);
  }

  const categoryTotals = model.categories.map((category) => ({
    categoryId: category.id,
    sourceStatistic: category.sourceStatistic,
    units: 0,
    milliPoints: 0,
  }));
  const categoryById = new Map(
    categoryTotals.map((category) => [category.categoryId, category]),
  );
  const uncertainties: FantasyScoringUncertainty[] = [];
  const scoredSources: FantasyScoredSource[] = [];
  let totalMilliPoints = 0;
  let completedSourceCount = 0;

  for (const slot of activeSlots) {
    if (slot.playerEntryId === null) {
      uncertainties.push({
        code: "EMPTY_LINEUP_SLOT",
        rosterSlotId: slot.id,
        fantasyPlayerEntryId: null,
        expectedGames: null,
        completedGames: null,
        projectedCompletionAt: null,
      });
      continue;
    }
    const source = sourcesBySlot.get(slot.id);
    if (!source) {
      uncertainties.push({
        code: "MISSING_STATISTICS",
        rosterSlotId: slot.id,
        fantasyPlayerEntryId: slot.playerEntryId,
        expectedGames: null,
        completedGames: null,
        projectedCompletionAt: null,
      });
      continue;
    }
    const uncertaintyCode = availabilityUncertainty(source);
    let score: FantasyScore | null = null;
    if (uncertaintyCode !== null) {
      uncertainties.push({
        code: uncertaintyCode,
        rosterSlotId: slot.id,
        fantasyPlayerEntryId: source.fantasyPlayerEntryId,
        expectedGames: source.expectedGames,
        completedGames: source.completedGames,
        projectedCompletionAt: source.projectedCompletionAt,
      });
    } else {
      score = scoreFantasyStatistics(model, source.snapshot!);
      completedSourceCount += 1;
      totalMilliPoints = safeAdd(totalMilliPoints, score.totalMilliPoints);
      for (const category of score.categories) {
        const aggregate = categoryById.get(category.categoryId);
        if (
          !aggregate ||
          aggregate.sourceStatistic !== category.sourceStatistic
        ) {
          scoringError(
            "SOURCE_CONFLICT",
            "Scored category does not match the sealed fantasy model.",
          );
        }
        aggregate.units = safeAdd(aggregate.units, category.units);
        aggregate.milliPoints = safeAdd(
          aggregate.milliPoints,
          category.milliPoints,
        );
      }
    }
    scoredSources.push({
      rosterSlotId: slot.id,
      fantasyPlayerEntryId: source.fantasyPlayerEntryId,
      availability: source.availability,
      expectedGames: source.expectedGames,
      completedGames: source.completedGames,
      projectedCompletionAt: source.projectedCompletionAt,
      score,
      statisticLineage:
        source.snapshot === null
          ? null
          : cloneStatisticLineage(source.snapshot.lineage),
    });
  }

  const periodEnd = Date.parse(input.period.endsAt);
  const finalizationDeadline = Date.parse(input.period.finalizationDeadline);
  const allResolved = uncertainties.every(
    (uncertainty) => uncertainty.code === "EMPTY_LINEUP_SLOT",
  );
  let status: FantasyTeamPeriodResult["status"] =
    calculatedAt < periodEnd
      ? "IN_PROGRESS"
      : !allResolved && calculatedAt < finalizationDeadline
        ? "AWAITING_FINAL_DATA"
        : "READY";
  if (input.finalize) {
    if (
      calculatedAt < periodEnd ||
      (!allResolved && calculatedAt < finalizationDeadline)
    ) {
      scoringError(
        "RESULT_NOT_READY",
        "Fantasy result cannot finalize before the period and uncertainty gates close.",
      );
    }
    status = "FINAL";
  }

  const sourceEnvelope = {
    contractVersion: FANTASY_SCORING_CONTRACT_VERSION,
    calculationVersion: FANTASY_SCORING_CALCULATION_VERSION,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    fantasyTeamId: input.fantasyTeamId,
    period: periodEnvelope(input.period),
    rosterSnapshotId: roster.id,
    rosterSnapshotRevision: roster.revision,
    fantasyModelVersionId: model.modelVersionId,
    fantasyModelDigest: model.contentDigest,
    statistics: [...input.statistics].sort((left, right) =>
      compareStableIds(left.rosterSlotId, right.rosterSlotId),
    ),
  };
  const sourceDigest = digest(sourceEnvelope);
  if (
    previous !== null &&
    (previous.accountId !== input.accountId ||
      previous.fantasyLeagueId !== input.fantasyLeagueId ||
      previous.fantasyTeamId !== input.fantasyTeamId ||
      !samePeriod(previous.period, input.period) ||
      previous.rosterSnapshotId !== roster.id ||
      previous.lineage.fantasyModelVersionId !== model.modelVersionId ||
      previous.lineage.fantasyModelDigest !== model.contentDigest ||
      (previous.status === "FINAL" && status !== "FINAL"))
  ) {
    scoringError(
      "REVISION_CONFLICT",
      "Fantasy result correction cannot change its Account, league, team, period, roster, model, or final state.",
    );
  }
  const revision = revisionDecision(
    {
      id: input.resultId,
      revision: input.revision,
      previousResultId: input.previousResultId,
      correctionReason: input.correctionReason,
      calculatedAt: input.calculatedAt,
    },
    sourceDigest,
    status,
    previous,
  );

  const scoreLineages = scoredSources.flatMap((source) =>
    source.score === null ? [] : [source.score.lineage],
  );
  const explicitProjections = uncertainties.map(
    (uncertainty) => uncertainty.projectedCompletionAt,
  );
  const projectedCompletionAt =
    uncertainties.length === 0 ||
    explicitProjections.some((value) => value === null)
      ? null
      : new Date(
          Math.max(...explicitProjections.map((value) => Date.parse(value!))),
        ).toISOString();
  const categoryOutput = cloneCategoryTotals(categoryTotals);
  const uncertaintyOutput = Object.freeze(
    uncertainties.map((uncertainty) => Object.freeze({ ...uncertainty })),
  );
  const sourceOutput = Object.freeze(
    scoredSources.map((source) =>
      Object.freeze({
        ...source,
        score: source.score,
        statisticLineage: source.statisticLineage,
      }),
    ),
  );
  const lineage = Object.freeze({
    fantasyModelId: model.modelId,
    fantasyModelVersionId: model.modelVersionId,
    fantasyModelVersion: model.version,
    fantasyModelDigest: model.contentDigest,
    baseballRulesetVersionIds: uniqueSortedStrings(
      scoreLineages.flatMap((item) => item.baseballRulesetVersionIds),
    ),
    statisticDerivationVersions: uniqueSortedNumbers(
      scoreLineages.map((item) => item.statisticDerivationVersion),
    ),
    statisticRulesVersions: uniqueSortedNumbers(
      scoreLineages.map((item) => item.statisticRulesVersion),
    ),
    sourceRevisions: uniqueSortedNumbers(
      scoreLineages.map((item) => item.sourceRevision),
    ),
    correctionRevisions: uniqueSortedNumbers(
      scoreLineages.map((item) => item.correctionRevision),
    ),
  });
  const audit = calculationAudit({
    id: input.auditId,
    authority,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    targetKind: "TEAM_PERIOD",
    targetId: input.resultId,
    teamIds: [input.fantasyTeamId],
    periodId: input.period.id,
    action: revision.action,
    acceptedAt: input.calculatedAt,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correctionReason: revision.correction?.reason ?? null,
  });
  const semanticResult = {
    contractVersion: FANTASY_SCORING_CONTRACT_VERSION,
    calculationVersion: FANTASY_SCORING_CALCULATION_VERSION,
    id: input.resultId,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    fantasyTeamId: input.fantasyTeamId,
    period: periodEnvelope(input.period),
    rosterSnapshotId: roster.id,
    rosterSnapshotRevision: roster.revision,
    status,
    totalMilliPoints,
    categoryTotals: categoryOutput,
    expectedSourceCount: activeSlots.filter(
      (slot) => slot.playerEntryId !== null,
    ).length,
    completedSourceCount,
    projectedCompletionAt,
    uncertainties: uncertaintyOutput,
    sources: sourceOutput,
    lineage,
    calculatedAt: input.calculatedAt,
    finalizedAt: status === "FINAL" ? input.calculatedAt : null,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correction: revision.correction,
    sourceDigest,
    audit,
  };
  return Object.freeze({
    ...semanticResult,
    period: Object.freeze({ ...input.period }),
    resultDigest: digest(semanticResult),
  });
}

function teamTotal(result: FantasyTeamPeriodResult): FantasyMatchupTeamTotal {
  return Object.freeze({
    fantasyTeamId: result.fantasyTeamId,
    totalMilliPoints: result.totalMilliPoints,
    categoryTotals: cloneCategoryTotals(result.categoryTotals),
    teamResultId: result.id,
    teamResultRevision: result.revision,
    teamResultDigest: result.resultDigest,
  });
}

export function calculateFantasyMatchup(
  input: FantasyMatchupCalculationInput,
  firstResult: FantasyTeamPeriodResult,
  secondResult: FantasyTeamPeriodResult,
  authority: FantasyDomainAuthority,
  previous: FantasyMatchupResult | null = null,
): FantasyMatchupResult {
  stableId(input.resultId, "Matchup result id");
  validateScoringAuthority(authority, input.accountId, input.fantasyLeagueId);
  canonicalInstant(input.calculatedAt, "Matchup calculation time");
  positiveInteger(input.firstPredeclaredSeed, "First predeclared seed");
  positiveInteger(input.secondPredeclaredSeed, "Second predeclared seed");
  if (
    firstResult.accountId !== input.accountId ||
    secondResult.accountId !== input.accountId
  ) {
    scoringError(
      "ACCOUNT_MISMATCH",
      "Matchup results crossed an Account boundary.",
    );
  }
  if (
    firstResult.fantasyLeagueId !== input.fantasyLeagueId ||
    secondResult.fantasyLeagueId !== input.fantasyLeagueId ||
    firstResult.fantasyTeamId === secondResult.fantasyTeamId ||
    !samePeriod(firstResult.period, secondResult.period)
  ) {
    scoringError(
      "MATCHUP_INVALID",
      "A matchup requires two distinct teams in the same exact league period.",
    );
  }
  if (
    input.firstPredeclaredSeed === input.secondPredeclaredSeed &&
    firstResult.period.phase !== "REGULAR_SEASON"
  ) {
    scoringError(
      "MATCHUP_INVALID",
      "Playoff and championship opponents require distinct predeclared seeds.",
    );
  }

  const status: FantasyMatchupResult["status"] =
    firstResult.status === "FINAL" && secondResult.status === "FINAL"
      ? "FINAL"
      : "IN_PROGRESS";
  let outcome: FantasyMatchupResult["outcome"] = "UNRESOLVED";
  let winnerTeamId: string | null = null;
  let loserTeamId: string | null = null;
  let tieBreak: FantasyMatchupResult["tieBreak"] = "NONE";
  if (status === "FINAL") {
    if (firstResult.totalMilliPoints > secondResult.totalMilliPoints) {
      outcome = "FIRST_WIN";
      winnerTeamId = firstResult.fantasyTeamId;
      loserTeamId = secondResult.fantasyTeamId;
    } else if (firstResult.totalMilliPoints < secondResult.totalMilliPoints) {
      outcome = "SECOND_WIN";
      winnerTeamId = secondResult.fantasyTeamId;
      loserTeamId = firstResult.fantasyTeamId;
    } else if (firstResult.period.phase === "REGULAR_SEASON") {
      outcome = "TIE";
    } else {
      tieBreak = "HIGHER_PREDECLARED_SEED";
      const firstWins =
        input.firstPredeclaredSeed < input.secondPredeclaredSeed;
      outcome = firstWins ? "FIRST_WIN" : "SECOND_WIN";
      winnerTeamId = firstWins
        ? firstResult.fantasyTeamId
        : secondResult.fantasyTeamId;
      loserTeamId = firstWins
        ? secondResult.fantasyTeamId
        : firstResult.fantasyTeamId;
    }
  }

  const lineage = aggregateResultLineage(
    [firstResult.lineage, secondResult.lineage],
    "MATCHUP_INVALID",
  );

  const sourceEnvelope = {
    first: {
      id: firstResult.id,
      revision: firstResult.revision,
      digest: firstResult.resultDigest,
    },
    second: {
      id: secondResult.id,
      revision: secondResult.revision,
      digest: secondResult.resultDigest,
    },
    firstPredeclaredSeed: input.firstPredeclaredSeed,
    secondPredeclaredSeed: input.secondPredeclaredSeed,
  };
  const sourceDigest = digest(sourceEnvelope);
  if (
    previous !== null &&
    (previous.accountId !== input.accountId ||
      previous.fantasyLeagueId !== input.fantasyLeagueId ||
      !samePeriod(previous.period, firstResult.period) ||
      previous.first.fantasyTeamId !== firstResult.fantasyTeamId ||
      previous.second.fantasyTeamId !== secondResult.fantasyTeamId ||
      !sameFantasyModelLineage(previous.lineage, lineage) ||
      (previous.status === "FINAL" && status !== "FINAL"))
  ) {
    scoringError(
      "REVISION_CONFLICT",
      "Matchup recalculation cannot change its competition identity or final state.",
    );
  }
  const revision = revisionDecision(
    {
      id: input.resultId,
      revision: input.revision,
      previousResultId: input.previousResultId,
      correctionReason: input.correctionReason,
      calculatedAt: input.calculatedAt,
    },
    sourceDigest,
    status,
    previous,
  );
  const first = teamTotal(firstResult);
  const second = teamTotal(secondResult);
  const audit = calculationAudit({
    id: input.auditId,
    authority,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    targetKind: "MATCHUP",
    targetId: input.resultId,
    teamIds: [first.fantasyTeamId, second.fantasyTeamId],
    periodId: firstResult.period.id,
    action: revision.action,
    acceptedAt: input.calculatedAt,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correctionReason: revision.correction?.reason ?? null,
  });
  const semanticResult = {
    contractVersion: FANTASY_SCORING_CONTRACT_VERSION,
    calculationVersion: FANTASY_SCORING_CALCULATION_VERSION,
    id: input.resultId,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    period: periodEnvelope(firstResult.period),
    status,
    first,
    second,
    outcome,
    winnerTeamId,
    loserTeamId,
    tieBreak,
    firstPredeclaredSeed: input.firstPredeclaredSeed,
    secondPredeclaredSeed: input.secondPredeclaredSeed,
    lineage,
    calculatedAt: input.calculatedAt,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correction: revision.correction,
    sourceDigest,
    audit,
  };
  return Object.freeze({
    ...semanticResult,
    period: Object.freeze({ ...firstResult.period }),
    resultDigest: digest(semanticResult),
  });
}

type MutableStanding = {
  fantasyTeamId: string;
  predeclaredSeed: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  pointsForMilli: number;
  pointsAgainstMilli: number;
  categoryTotals: Map<string, FantasyCategoryTotal>;
  outcomes: { sequence: number; value: "W" | "L" | "T" }[];
};

function addCategories(
  target: Map<string, FantasyCategoryTotal>,
  categories: readonly FantasyCategoryTotal[],
): void {
  for (const category of categories) {
    const current = target.get(category.categoryId);
    if (current && current.sourceStatistic !== category.sourceStatistic) {
      scoringError(
        "STANDINGS_INVALID",
        "Standing category identity changed between matchup results.",
      );
    }
    target.set(category.categoryId, {
      categoryId: category.categoryId,
      sourceStatistic: category.sourceStatistic,
      units: safeAdd(current?.units ?? 0, category.units),
      milliPoints: safeAdd(current?.milliPoints ?? 0, category.milliPoints),
    });
  }
}

function streak(values: MutableStanding["outcomes"]): string {
  if (values.length === 0) return "-";
  const sorted = [...values].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const latest = sorted.at(-1)!.value;
  let count = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index]!.value !== latest) break;
    count += 1;
  }
  return `${latest}${count}`;
}

export function calculateFantasyStandings(
  input: FantasyStandingsCalculationInput,
  matchups: readonly FantasyMatchupResult[],
  authority: FantasyDomainAuthority,
  previous: FantasyStandingsResult | null = null,
): FantasyStandingsResult {
  stableId(input.resultId, "Standings result id");
  validateScoringAuthority(authority, input.accountId, input.fantasyLeagueId);
  canonicalInstant(input.calculatedAt, "Standings calculation time");
  nonnegativeInteger(input.playoffTeamCount, "Playoff team count");
  if (
    input.teams.length < 2 ||
    input.playoffTeamCount > input.teams.length ||
    new Set(input.teams.map((team) => team.fantasyTeamId)).size !==
      input.teams.length ||
    new Set(input.teams.map((team) => team.predeclaredSeed)).size !==
      input.teams.length
  ) {
    scoringError(
      "STANDINGS_INVALID",
      "Standings require unique teams and predeclared seeds.",
    );
  }
  const lineage = aggregateResultLineage(
    matchups.map((matchup) => matchup.lineage),
    "STANDINGS_INVALID",
  );
  const standings = new Map<string, MutableStanding>();
  for (const team of input.teams) {
    stableId(team.fantasyTeamId, "Standing team id");
    positiveInteger(team.predeclaredSeed, "Standing predeclared seed");
    standings.set(team.fantasyTeamId, {
      ...team,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsForMilli: 0,
      pointsAgainstMilli: 0,
      categoryTotals: new Map(),
      outcomes: [],
    });
  }
  const seenTeamPeriods = new Set<string>();
  let completedMatchupCount = 0;
  let pendingMatchupCount = 0;
  for (const matchup of matchups) {
    if (
      matchup.accountId !== input.accountId ||
      matchup.fantasyLeagueId !== input.fantasyLeagueId
    ) {
      scoringError(
        "ACCOUNT_MISMATCH",
        "Standings crossed an Account or league boundary.",
      );
    }
    if (matchup.period.phase !== "REGULAR_SEASON") {
      scoringError(
        "STANDINGS_INVALID",
        "Regular-season standings cannot consume playoff matchups.",
      );
    }
    const first = standings.get(matchup.first.fantasyTeamId);
    const second = standings.get(matchup.second.fantasyTeamId);
    if (!first || !second) {
      scoringError(
        "STANDINGS_INVALID",
        "Matchup contains an unknown standing team.",
      );
    }
    for (const teamId of [first.fantasyTeamId, second.fantasyTeamId]) {
      const key = `${teamId}:${matchup.period.sequence}`;
      if (seenTeamPeriods.has(key)) {
        scoringError(
          "STANDINGS_INVALID",
          "A team cannot have two standings matchups in one period.",
        );
      }
      seenTeamPeriods.add(key);
    }
    if (matchup.status !== "FINAL") {
      pendingMatchupCount += 1;
      continue;
    }
    completedMatchupCount += 1;
    first.gamesPlayed += 1;
    second.gamesPlayed += 1;
    first.pointsForMilli = safeAdd(
      first.pointsForMilli,
      matchup.first.totalMilliPoints,
    );
    first.pointsAgainstMilli = safeAdd(
      first.pointsAgainstMilli,
      matchup.second.totalMilliPoints,
    );
    second.pointsForMilli = safeAdd(
      second.pointsForMilli,
      matchup.second.totalMilliPoints,
    );
    second.pointsAgainstMilli = safeAdd(
      second.pointsAgainstMilli,
      matchup.first.totalMilliPoints,
    );
    addCategories(first.categoryTotals, matchup.first.categoryTotals);
    addCategories(second.categoryTotals, matchup.second.categoryTotals);
    if (matchup.outcome === "TIE") {
      first.ties += 1;
      second.ties += 1;
      first.outcomes.push({ sequence: matchup.period.sequence, value: "T" });
      second.outcomes.push({ sequence: matchup.period.sequence, value: "T" });
    } else if (matchup.winnerTeamId === first.fantasyTeamId) {
      first.wins += 1;
      second.losses += 1;
      first.outcomes.push({ sequence: matchup.period.sequence, value: "W" });
      second.outcomes.push({ sequence: matchup.period.sequence, value: "L" });
    } else if (matchup.winnerTeamId === second.fantasyTeamId) {
      second.wins += 1;
      first.losses += 1;
      second.outcomes.push({ sequence: matchup.period.sequence, value: "W" });
      first.outcomes.push({ sequence: matchup.period.sequence, value: "L" });
    } else {
      scoringError("STANDINGS_INVALID", "Final matchup outcome is incomplete.");
    }
  }

  const ordered = [...standings.values()].sort((left, right) => {
    const leftStandingPoints = left.wins * 2 + left.ties;
    const rightStandingPoints = right.wins * 2 + right.ties;
    const leftDifferential = safeDifference(
      left.pointsForMilli,
      left.pointsAgainstMilli,
    );
    const rightDifferential = safeDifference(
      right.pointsForMilli,
      right.pointsAgainstMilli,
    );
    return (
      compareNumbersDescending(leftStandingPoints, rightStandingPoints) ||
      compareNumbersDescending(leftDifferential, rightDifferential) ||
      compareNumbersDescending(left.pointsForMilli, right.pointsForMilli) ||
      compareNumbersAscending(left.predeclaredSeed, right.predeclaredSeed) ||
      compareStableIds(left.fantasyTeamId, right.fantasyTeamId)
    );
  });
  const status: FantasyStandingsResult["status"] =
    input.regularSeasonComplete && pendingMatchupCount === 0
      ? "FINAL"
      : "IN_PROGRESS";
  const records = Object.freeze(
    ordered.map((standing, index) => {
      const rank = index + 1;
      const pointsDifferentialMilli = safeDifference(
        standing.pointsForMilli,
        standing.pointsAgainstMilli,
      );
      const playoffQualification: FantasyStandingRecord["playoffQualification"] =
        rank <= input.playoffTeamCount
          ? status === "FINAL"
            ? "QUALIFIED"
            : "CURRENT_CUTOFF"
          : "NOT_QUALIFIED";
      return Object.freeze({
        rank,
        fantasyTeamId: standing.fantasyTeamId,
        predeclaredSeed: standing.predeclaredSeed,
        gamesPlayed: standing.gamesPlayed,
        wins: standing.wins,
        losses: standing.losses,
        ties: standing.ties,
        standingPoints: standing.wins * 2 + standing.ties,
        pointsForMilli: standing.pointsForMilli,
        pointsAgainstMilli: standing.pointsAgainstMilli,
        pointsDifferentialMilli,
        categoryTotals: cloneCategoryTotals(
          [...standing.categoryTotals.values()].sort((left, right) =>
            compareStableIds(left.categoryId, right.categoryId),
          ),
        ),
        currentStreak: streak(standing.outcomes),
        playoffQualification,
      });
    }),
  );
  const throughPeriodSequence = matchups.reduce(
    (current, matchup) => Math.max(current, matchup.period.sequence),
    0,
  );
  const sourceMatchups = Object.freeze(
    [...matchups]
      .sort(
        (left, right) =>
          compareNumbersAscending(
            left.period.sequence,
            right.period.sequence,
          ) || compareStableIds(left.id, right.id),
      )
      .map((matchup) =>
        Object.freeze({
          id: matchup.id,
          revision: matchup.revision,
          digest: matchup.resultDigest,
        }),
      ),
  );
  const sourceDigest = digest({
    regularSeasonComplete: input.regularSeasonComplete,
    playoffTeamCount: input.playoffTeamCount,
    teams: [...input.teams].sort((left, right) =>
      compareStableIds(left.fantasyTeamId, right.fantasyTeamId),
    ),
    sourceMatchups,
  });
  if (
    previous !== null &&
    (previous.accountId !== input.accountId ||
      previous.fantasyLeagueId !== input.fantasyLeagueId ||
      !sameFantasyModelLineage(previous.lineage, lineage) ||
      (previous.status === "FINAL" && status !== "FINAL"))
  ) {
    scoringError(
      "REVISION_CONFLICT",
      "Standings recalculation cannot change competition identity or final state.",
    );
  }
  const revision = revisionDecision(
    {
      id: input.resultId,
      revision: input.revision,
      previousResultId: input.previousResultId,
      correctionReason: input.correctionReason,
      calculatedAt: input.calculatedAt,
    },
    sourceDigest,
    status,
    previous,
  );
  const audit = calculationAudit({
    id: input.auditId,
    authority,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    targetKind: "STANDINGS",
    targetId: input.resultId,
    teamIds: records.map((record) => record.fantasyTeamId),
    periodId: null,
    action: revision.action,
    acceptedAt: input.calculatedAt,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correctionReason: revision.correction?.reason ?? null,
  });
  const semanticResult = {
    contractVersion: FANTASY_SCORING_CONTRACT_VERSION,
    calculationVersion: FANTASY_SCORING_CALCULATION_VERSION,
    id: input.resultId,
    accountId: input.accountId,
    fantasyLeagueId: input.fantasyLeagueId,
    status,
    throughPeriodSequence,
    playoffTeamCount: input.playoffTeamCount,
    completedMatchupCount,
    pendingMatchupCount,
    records,
    sourceMatchups,
    lineage,
    calculatedAt: input.calculatedAt,
    revision: input.revision,
    previousResultId: input.previousResultId,
    correction: revision.correction,
    sourceDigest,
    audit,
  };
  return Object.freeze({
    ...semanticResult,
    resultDigest: digest(semanticResult),
  });
}

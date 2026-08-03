import { createHash } from "node:crypto";

import { canonicalJson } from "@/domain/events/event-log";

export const FANTASY_RULES_CONTRACT_VERSION = 1 as const;
export const INITIAL_FANTASY_FORMAT = "WEEKLY_HEAD_TO_HEAD_POINTS" as const;

export const initialFantasyStatisticCodes = [
  "batting.runs",
  "batting.hits",
  "batting.doubles",
  "batting.triples",
  "batting.home_runs",
  "batting.runs_batted_in",
  "batting.walks",
  "batting.stolen_bases",
  "batting.strikeouts",
  "pitching.outs_recorded",
  "pitching.strikeouts",
  "pitching.earned_runs",
  "pitching.walks",
] as const;

export type InitialFantasyStatisticCode =
  (typeof initialFantasyStatisticCodes)[number];

export type FantasyRulesErrorCode =
  | "INVALID_MODEL"
  | "INVALID_DIGEST"
  | "INVALID_TRANSITION"
  | "MODEL_NOT_SCORABLE"
  | "STATISTIC_REGISTRY_MISMATCH"
  | "STATISTIC_UNAVAILABLE"
  | "STATISTIC_INVALID"
  | "UNVERIFIED_STATISTICS"
  | "ACCOUNT_NOT_AUTHORIZED"
  | "NOT_ROSTERED_AT_LOCK"
  | "LINEUP_SLOT_UNKNOWN"
  | "POSITION_INELIGIBLE";

export class FantasyRulesError extends Error {
  constructor(
    readonly code: FantasyRulesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FantasyRulesError";
  }
}

export type FantasyModelOwner =
  | Readonly<{ kind: "PLATFORM"; id: null }>
  | Readonly<{
      kind: "ORGANIZATION" | "LEAGUE" | "ACCOUNT";
      id: string;
    }>;

export type FantasyModelLifecycle =
  "DRAFT" | "REVIEWED" | "ACTIVE" | "DEPRECATED" | "RETIRED";

export type FantasyScoringCategory = Readonly<{
  id: string;
  domain: "BATTING" | "PITCHING" | "FIELDING" | "CUSTOM";
  sourceStatistic: string;
  label: string;
  milliPointsPerUnit: number;
}>;

export type FantasyPositionEligibilityRule = Readonly<{
  positionCode: string;
  minimumAppearances: number;
  minimumPitchingOuts: number;
}>;

export type FantasyEligibilityRules = Readonly<{
  rosterSource: "EXACT_ACCOUNT_ROSTER_AT_LOCK";
  unknownEligibility: "INELIGIBLE";
  positionRules: readonly FantasyPositionEligibilityRule[];
}>;

export type FantasyLineupSlotRule = Readonly<{
  id: string;
  count: number;
  eligiblePositionCodes: readonly string[];
}>;

export type FantasyRosterRules = Readonly<{
  maximumRosterSize: number;
  benchSlots: number;
  lineupSlots: readonly FantasyLineupSlotRule[];
  lineupLock: "WEEKLY_PERIOD_START";
  missingLineupBehavior: "ZERO_POINTS";
  benchScoring: "EXCLUDED";
}>;

export type FantasyCadenceRules = Readonly<{
  periodKind: "WEEKLY";
  boundarySource: "SEALED_UTC_INTERVALS";
  completionGraceHours: number;
  correctionPolicy: "BEFORE_FINALIZATION_ONLY";
  regularSeasonTie: "TIE";
  playoffTieBreaker: "HIGHER_PREDECLARED_SEED";
}>;

export type FantasyScoringModelVersion = Readonly<{
  contractVersion: typeof FANTASY_RULES_CONTRACT_VERSION;
  modelId: string;
  modelVersionId: string;
  owner: FantasyModelOwner;
  version: number;
  name: string;
  format: typeof INITIAL_FANTASY_FORMAT;
  statisticRegistryVersion: string;
  categories: readonly FantasyScoringCategory[];
  eligibility: FantasyEligibilityRules;
  roster: FantasyRosterRules;
  cadence: FantasyCadenceRules;
  lifecycle: FantasyModelLifecycle;
  contentDigest: string;
}>;

export type FantasyScoringModelInput = Omit<
  FantasyScoringModelVersion,
  "contractVersion" | "contentDigest"
>;

export type FantasyAccountAuthority = Readonly<{
  accountId: string;
  authorityReferenceIds: readonly string[];
  authorizedAt: string;
}>;

export type FantasyStatisticSnapshot = Readonly<{
  accountId: string;
  authority: FantasyAccountAuthority;
  values: Readonly<Record<string, number>>;
  lineage: Readonly<{
    baseballRulesetVersionIds: readonly string[];
    statisticDerivationVersion: number;
    statisticRulesVersion: number;
    sourceRevision: number;
    correctionRevision: number;
    fantasyStatisticRegistryVersion: string;
    lifecycle: "FINAL" | "INCOMPLETE";
    verification: "VERIFIED" | "UNVERIFIED";
  }>;
}>;

export type FantasyScore = Readonly<{
  totalMilliPoints: number;
  categories: readonly Readonly<{
    categoryId: string;
    sourceStatistic: string;
    units: number;
    milliPoints: number;
  }>[];
  lineage: Readonly<{
    accountId: string;
    fantasyModelId: string;
    fantasyModelVersionId: string;
    fantasyModelVersion: number;
    fantasyModelDigest: string;
    baseballRulesetVersionIds: readonly string[];
    statisticDerivationVersion: number;
    statisticRulesVersion: number;
    sourceRevision: number;
    correctionRevision: number;
  }>;
}>;

export type FantasyEligibilityFacts = Readonly<{
  accountId: string;
  rosterAccountId: string;
  authority: FantasyAccountAuthority;
  rosteredAtLock: boolean;
  requestedSlotId: string;
  verifiedPositionAppearances: Readonly<Record<string, number>>;
  pitchingOuts: number;
}>;

export type FantasyEligibilityDecision =
  | Readonly<{
      eligible: true;
      slotId: string;
      qualifyingPositions: readonly string[];
    }>
  | Readonly<{
      eligible: false;
      code: Extract<
        FantasyRulesErrorCode,
        | "ACCOUNT_NOT_AUTHORIZED"
        | "NOT_ROSTERED_AT_LOCK"
        | "LINEUP_SLOT_UNKNOWN"
        | "POSITION_INELIGIBLE"
      >;
    }>;

const allowedTransitions: Readonly<
  Record<FantasyModelLifecycle, readonly FantasyModelLifecycle[]>
> = {
  DRAFT: ["REVIEWED"],
  REVIEWED: ["ACTIVE"],
  ACTIVE: ["DEPRECATED"],
  DEPRECATED: ["RETIRED"],
  RETIRED: [],
};

const fantasyModelLifecycles = new Set<FantasyModelLifecycle>([
  "DRAFT",
  "REVIEWED",
  "ACTIVE",
  "DEPRECATED",
  "RETIRED",
]);
const fantasyOwnerKinds = new Set<FantasyModelOwner["kind"]>([
  "PLATFORM",
  "ORGANIZATION",
  "LEAGUE",
  "ACCOUNT",
]);
const fantasyCategoryDomains = new Set<FantasyScoringCategory["domain"]>([
  "BATTING",
  "PITCHING",
  "FIELDING",
  "CUSTOM",
]);

function requireNonempty(value: string, label: string): void {
  if (value.length === 0) {
    throw new FantasyRulesError("INVALID_MODEL", `${label} is required.`);
  }
}

function requireNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      `${label} must be a nonnegative safe integer.`,
    );
  }
}

function accountAuthorityMatches(
  authority: FantasyAccountAuthority,
  accountId: string,
): boolean {
  const authorizedTime = Date.parse(authority.authorizedAt);
  return (
    accountId.length > 0 &&
    authority.accountId === accountId &&
    authority.authorityReferenceIds.length > 0 &&
    new Set(authority.authorityReferenceIds).size ===
      authority.authorityReferenceIds.length &&
    authority.authorityReferenceIds.every((id) => id.length > 0) &&
    Number.isFinite(authorizedTime) &&
    new Date(authorizedTime).toISOString() === authority.authorizedAt
  );
}

function semanticEnvelope(
  model: FantasyScoringModelInput | FantasyScoringModelVersion,
) {
  return {
    contractVersion: FANTASY_RULES_CONTRACT_VERSION,
    modelId: model.modelId,
    modelVersionId: model.modelVersionId,
    owner: model.owner,
    version: model.version,
    name: model.name,
    format: model.format,
    statisticRegistryVersion: model.statisticRegistryVersion,
    categories: model.categories,
    eligibility: model.eligibility,
    roster: model.roster,
    cadence: model.cadence,
  };
}

export function fantasyModelDigest(
  model: FantasyScoringModelInput | FantasyScoringModelVersion,
): string {
  return `sha256:v1:${createHash("sha256")
    .update(canonicalJson(semanticEnvelope(model)))
    .digest("hex")}`;
}

function validateModel(model: FantasyScoringModelInput): void {
  requireNonempty(model.modelId, "Model id");
  requireNonempty(model.modelVersionId, "Model version id");
  requireNonempty(model.name, "Model name");
  requireNonempty(model.statisticRegistryVersion, "Statistic registry version");
  if (
    model.format !== INITIAL_FANTASY_FORMAT ||
    !fantasyModelLifecycles.has(model.lifecycle) ||
    !fantasyOwnerKinds.has(model.owner.kind)
  ) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Fantasy format, lifecycle, or owner kind is unsupported.",
    );
  }
  if (model.owner.kind === "PLATFORM") {
    if (model.owner.id !== null) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Platform owner id must be null.",
      );
    }
  } else {
    requireNonempty(model.owner.id, "Owner id");
  }
  if (!Number.isSafeInteger(model.version) || model.version < 1) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Model version must be a positive safe integer.",
    );
  }
  if (model.categories.length === 0) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "At least one scoring category is required.",
    );
  }
  const categoryIds = new Set<string>();
  for (const category of model.categories) {
    requireNonempty(category.id, "Category id");
    requireNonempty(category.label, "Category label");
    requireNonempty(category.sourceStatistic, "Source statistic");
    if (!fantasyCategoryDomains.has(category.domain)) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Fantasy category domain is unsupported.",
      );
    }
    if (categoryIds.has(category.id)) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Category ids must be unique within a model version.",
      );
    }
    categoryIds.add(category.id);
    if (
      !Number.isSafeInteger(category.milliPointsPerUnit) ||
      category.milliPointsPerUnit === 0
    ) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Category weights must be nonzero safe integer milli-points.",
      );
    }
  }

  const positionCodes = new Set<string>();
  if (
    model.eligibility.rosterSource !== "EXACT_ACCOUNT_ROSTER_AT_LOCK" ||
    model.eligibility.unknownEligibility !== "INELIGIBLE"
  ) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Fantasy eligibility source or unknown policy is unsupported.",
    );
  }
  for (const rule of model.eligibility.positionRules) {
    requireNonempty(rule.positionCode, "Position code");
    if (positionCodes.has(rule.positionCode)) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Position eligibility codes must be unique.",
      );
    }
    positionCodes.add(rule.positionCode);
    requireNonnegativeInteger(
      rule.minimumAppearances,
      "Minimum position appearances",
    );
    requireNonnegativeInteger(
      rule.minimumPitchingOuts,
      "Minimum pitching outs",
    );
  }

  requireNonnegativeInteger(model.roster.maximumRosterSize, "Roster size");
  requireNonnegativeInteger(model.roster.benchSlots, "Bench slots");
  if (
    model.roster.lineupLock !== "WEEKLY_PERIOD_START" ||
    model.roster.missingLineupBehavior !== "ZERO_POINTS" ||
    model.roster.benchScoring !== "EXCLUDED"
  ) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Fantasy lineup lock or scoring behavior is unsupported.",
    );
  }
  if (
    model.roster.maximumRosterSize === 0 ||
    model.roster.lineupSlots.length === 0
  ) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "A fantasy roster requires a positive size and at least one lineup slot.",
    );
  }
  const slotIds = new Set<string>();
  let activeSlots = 0;
  for (const slot of model.roster.lineupSlots) {
    requireNonempty(slot.id, "Lineup slot id");
    if (slotIds.has(slot.id) || slot.eligiblePositionCodes.length === 0) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Lineup slots require a unique id and eligible positions.",
      );
    }
    slotIds.add(slot.id);
    if (
      new Set(slot.eligiblePositionCodes).size !==
      slot.eligiblePositionCodes.length
    ) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Lineup slot position codes must be unique.",
      );
    }
    if (!Number.isSafeInteger(slot.count) || slot.count < 1) {
      throw new FantasyRulesError(
        "INVALID_MODEL",
        "Lineup slot count must be a positive safe integer.",
      );
    }
    activeSlots += slot.count;
    for (const positionCode of slot.eligiblePositionCodes) {
      if (!positionCodes.has(positionCode)) {
        throw new FantasyRulesError(
          "INVALID_MODEL",
          "Every lineup position must have an eligibility rule.",
        );
      }
    }
  }
  if (
    !Number.isSafeInteger(activeSlots) ||
    activeSlots + model.roster.benchSlots > model.roster.maximumRosterSize
  ) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Active and bench slots must fit the maximum roster size.",
    );
  }
  if (
    model.cadence.periodKind !== "WEEKLY" ||
    model.cadence.boundarySource !== "SEALED_UTC_INTERVALS" ||
    model.cadence.correctionPolicy !== "BEFORE_FINALIZATION_ONLY" ||
    model.cadence.regularSeasonTie !== "TIE" ||
    model.cadence.playoffTieBreaker !== "HIGHER_PREDECLARED_SEED" ||
    !Number.isSafeInteger(model.cadence.completionGraceHours) ||
    model.cadence.completionGraceHours < 0 ||
    model.cadence.completionGraceHours > 168
  ) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Completion grace must be an integer from zero through 168 hours.",
    );
  }
}

function freezeModel(
  model: FantasyScoringModelVersion,
): FantasyScoringModelVersion {
  return Object.freeze({
    ...model,
    owner: Object.freeze({ ...model.owner }),
    categories: Object.freeze(
      model.categories.map((category) => Object.freeze({ ...category })),
    ),
    eligibility: Object.freeze({
      ...model.eligibility,
      positionRules: Object.freeze(
        model.eligibility.positionRules.map((rule) =>
          Object.freeze({ ...rule }),
        ),
      ),
    }),
    roster: Object.freeze({
      ...model.roster,
      lineupSlots: Object.freeze(
        model.roster.lineupSlots.map((slot) =>
          Object.freeze({
            ...slot,
            eligiblePositionCodes: Object.freeze([
              ...slot.eligiblePositionCodes,
            ]),
          }),
        ),
      ),
    }),
    cadence: Object.freeze({ ...model.cadence }),
  });
}

export function createFantasyScoringModelVersion(
  input: FantasyScoringModelInput,
): FantasyScoringModelVersion {
  if (input.lifecycle !== "DRAFT") {
    throw new FantasyRulesError(
      "INVALID_TRANSITION",
      "A new fantasy scoring model version must begin in DRAFT.",
    );
  }
  validateModel(input);
  return freezeModel({
    ...input,
    contractVersion: FANTASY_RULES_CONTRACT_VERSION,
    contentDigest: fantasyModelDigest(input),
  });
}

export function verifyFantasyScoringModel(
  model: FantasyScoringModelVersion,
): void {
  validateModel(model);
  if (model.contractVersion !== FANTASY_RULES_CONTRACT_VERSION) {
    throw new FantasyRulesError(
      "INVALID_MODEL",
      "Fantasy rules contract version is unsupported.",
    );
  }
  if (model.contentDigest !== fantasyModelDigest(model)) {
    throw new FantasyRulesError(
      "INVALID_DIGEST",
      "Fantasy scoring model content digest does not match its semantics.",
    );
  }
}

export function fantasyModelIsEditable(
  model: FantasyScoringModelVersion,
): boolean {
  verifyFantasyScoringModel(model);
  return model.lifecycle === "DRAFT";
}

export function transitionFantasyScoringModel(
  model: FantasyScoringModelVersion,
  lifecycle: FantasyModelLifecycle,
): FantasyScoringModelVersion {
  verifyFantasyScoringModel(model);
  if (!allowedTransitions[model.lifecycle].includes(lifecycle)) {
    throw new FantasyRulesError(
      "INVALID_TRANSITION",
      `Fantasy model cannot transition from ${model.lifecycle} to ${lifecycle}.`,
    );
  }
  return freezeModel({ ...model, lifecycle });
}

export function scoreFantasyStatistics(
  model: FantasyScoringModelVersion,
  snapshot: FantasyStatisticSnapshot,
): FantasyScore {
  verifyFantasyScoringModel(model);
  if (!["ACTIVE", "DEPRECATED", "RETIRED"].includes(model.lifecycle)) {
    throw new FantasyRulesError(
      "MODEL_NOT_SCORABLE",
      "Only an activated or historical model version can score statistics.",
    );
  }
  if (
    !accountAuthorityMatches(snapshot.authority, snapshot.accountId) ||
    (model.owner.kind === "ACCOUNT" && model.owner.id !== snapshot.accountId)
  ) {
    throw new FantasyRulesError(
      "ACCOUNT_NOT_AUTHORIZED",
      "Fantasy statistics are not authorized for this Account and owner.",
    );
  }
  if (
    snapshot.lineage.verification !== "VERIFIED" ||
    snapshot.lineage.lifecycle !== "FINAL"
  ) {
    throw new FantasyRulesError(
      "UNVERIFIED_STATISTICS",
      "Fantasy scoring requires a verified final statistics projection.",
    );
  }
  const lineage = snapshot.lineage;
  if (
    lineage.baseballRulesetVersionIds.length === 0 ||
    new Set(lineage.baseballRulesetVersionIds).size !==
      lineage.baseballRulesetVersionIds.length ||
    lineage.baseballRulesetVersionIds.some((id) => id.length === 0) ||
    !Number.isSafeInteger(lineage.statisticDerivationVersion) ||
    lineage.statisticDerivationVersion < 1 ||
    !Number.isSafeInteger(lineage.statisticRulesVersion) ||
    lineage.statisticRulesVersion < 1 ||
    !Number.isSafeInteger(lineage.sourceRevision) ||
    lineage.sourceRevision < 0 ||
    !Number.isSafeInteger(lineage.correctionRevision) ||
    lineage.correctionRevision < 0
  ) {
    throw new FantasyRulesError(
      "STATISTIC_INVALID",
      "Fantasy scoring requires complete versioned statistic lineage.",
    );
  }
  if (
    snapshot.lineage.fantasyStatisticRegistryVersion !==
    model.statisticRegistryVersion
  ) {
    throw new FantasyRulesError(
      "STATISTIC_REGISTRY_MISMATCH",
      "Statistic registry version does not match the fantasy model.",
    );
  }

  let totalMilliPoints = 0;
  const categoryScores = model.categories.map((category) => {
    const units = snapshot.values[category.sourceStatistic];
    if (units === undefined) {
      throw new FantasyRulesError(
        "STATISTIC_UNAVAILABLE",
        `Required statistic ${category.sourceStatistic} is unavailable.`,
      );
    }
    if (!Number.isSafeInteger(units) || units < 0) {
      throw new FantasyRulesError(
        "STATISTIC_INVALID",
        "Fantasy statistic values must be nonnegative safe integers.",
      );
    }
    const milliPoints = units * category.milliPointsPerUnit;
    if (!Number.isSafeInteger(milliPoints)) {
      throw new FantasyRulesError(
        "STATISTIC_INVALID",
        "Fantasy category score exceeds safe integer arithmetic.",
      );
    }
    totalMilliPoints += milliPoints;
    if (!Number.isSafeInteger(totalMilliPoints)) {
      throw new FantasyRulesError(
        "STATISTIC_INVALID",
        "Fantasy total exceeds safe integer arithmetic.",
      );
    }
    return {
      categoryId: category.id,
      sourceStatistic: category.sourceStatistic,
      units,
      milliPoints,
    };
  });

  return Object.freeze({
    totalMilliPoints,
    categories: Object.freeze(
      categoryScores.map((category) => Object.freeze(category)),
    ),
    lineage: Object.freeze({
      accountId: snapshot.accountId,
      fantasyModelId: model.modelId,
      fantasyModelVersionId: model.modelVersionId,
      fantasyModelVersion: model.version,
      fantasyModelDigest: model.contentDigest,
      baseballRulesetVersionIds: Object.freeze([
        ...snapshot.lineage.baseballRulesetVersionIds,
      ]),
      statisticDerivationVersion: snapshot.lineage.statisticDerivationVersion,
      statisticRulesVersion: snapshot.lineage.statisticRulesVersion,
      sourceRevision: snapshot.lineage.sourceRevision,
      correctionRevision: snapshot.lineage.correctionRevision,
    }),
  });
}

export function evaluateFantasyEligibility(
  model: FantasyScoringModelVersion,
  facts: FantasyEligibilityFacts,
): FantasyEligibilityDecision {
  verifyFantasyScoringModel(model);
  if (
    facts.accountId !== facts.rosterAccountId ||
    !accountAuthorityMatches(facts.authority, facts.accountId)
  ) {
    return { eligible: false, code: "ACCOUNT_NOT_AUTHORIZED" };
  }
  if (!facts.rosteredAtLock) {
    return { eligible: false, code: "NOT_ROSTERED_AT_LOCK" };
  }
  const slot = model.roster.lineupSlots.find(
    ({ id }) => id === facts.requestedSlotId,
  );
  if (!slot) return { eligible: false, code: "LINEUP_SLOT_UNKNOWN" };
  if (!Number.isSafeInteger(facts.pitchingOuts) || facts.pitchingOuts < 0) {
    return { eligible: false, code: "POSITION_INELIGIBLE" };
  }
  const rulesByPosition = new Map(
    model.eligibility.positionRules.map((rule) => [rule.positionCode, rule]),
  );
  const qualifyingPositions = slot.eligiblePositionCodes.filter(
    (positionCode) => {
      const rule = rulesByPosition.get(positionCode);
      const appearances = facts.verifiedPositionAppearances[positionCode];
      return (
        rule !== undefined &&
        appearances !== undefined &&
        Number.isSafeInteger(appearances) &&
        appearances >= rule.minimumAppearances &&
        facts.pitchingOuts >= rule.minimumPitchingOuts
      );
    },
  );
  return qualifyingPositions.length > 0
    ? { eligible: true, slotId: slot.id, qualifyingPositions }
    : { eligible: false, code: "POSITION_INELIGIBLE" };
}

export type FantasyRulesAction =
  "VIEW" | "EDIT_DRAFT" | "REVIEW" | "ACTIVATE" | "DEPRECATE" | "RETIRE";

export function fantasyRulesCapability(
  action: FantasyRulesAction,
): "fantasy.rules.manage" | "fantasy.rules.activate" {
  return action === "ACTIVATE"
    ? "fantasy.rules.activate"
    : "fantasy.rules.manage";
}

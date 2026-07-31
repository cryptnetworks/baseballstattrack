import { createHash } from "node:crypto";

import {
  canonicalJson,
  replayGame,
  replayGameTimeline,
  resolveEffectiveEvents,
  type AcceptedEvent,
  type AcceptedSetup,
  type GameState,
} from "@/domain/events/event-log";
import {
  buildGameBoxScore,
  type BoxScorePresentation,
  type GameBoxScore,
} from "@/domain/reports";
import {
  portableGameSummary,
  type PortableGameSummary,
} from "@/domain/portable-data";
import {
  STATISTIC_DERIVATION_VERSION,
  deriveGameStatistics,
  type GameStatisticsProjection,
} from "@/domain/statistics";

export const DATA_RECONCILIATION_VERSION = 1 as const;

export type DataConfidenceState =
  | "VERIFIED"
  | "CURRENT"
  | "STALE"
  | "INCOMPLETE"
  | "CORRECTED"
  | "INTEGRITY_FAILURE";

export type DataDiscrepancyCategory =
  | "SOURCE_HISTORY"
  | "EFFECTIVE_HISTORY"
  | "REPLAY_STATE"
  | "SCORE"
  | "OUTS_AND_RUNNERS"
  | "PLAYER_TOTALS"
  | "TEAM_TOTALS"
  | "DERIVED_RATES"
  | "PROJECTION_FRESHNESS"
  | "REPORT"
  | "EXPORT"
  | "VERIFICATION";

export type DataRemediation =
  | "REPLAY_SOURCE"
  | "REBUILD_PROJECTION"
  | "REGENERATE_REPORT"
  | "REGENERATE_EXPORT"
  | "REVERIFY_GAME"
  | "RESUME_OR_COMPLETE_GAME"
  | "REVIEW_TERMINATED_GAME"
  | "ESCALATE_INTEGRITY";

export type DataReconciliationFinding = Readonly<{
  category: DataDiscrepancyCategory;
  code: string;
  severity: "BLOCKING" | "WARNING";
  remediation: DataRemediation;
  context: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ReconciliationProjectionEvidence = Readonly<{
  sourceRevision: number;
  privacyOverlayRevision: number;
  derivationVersion: number;
  status: "PENDING" | "BUILDING" | "CURRENT" | "FAILED" | "STALE";
}>;

export type DataReconciliationObservations = Readonly<{
  replayState?: GameState;
  statistics?: GameStatisticsProjection;
  boxScore?: GameBoxScore;
  exportSummary?: PortableGameSummary;
}>;

export type DataReconciliationReport = Readonly<{
  version: typeof DATA_RECONCILIATION_VERSION;
  confidence: DataConfidenceState;
  freshness: "CURRENT" | "STALE" | "INCOMPLETE" | "UNKNOWN";
  blocking: boolean;
  findings: readonly DataReconciliationFinding[];
  provenance: Readonly<{
    accountId: string;
    gameId: string;
    setupSnapshotId: string;
    setupRevision: number;
    sourceRevision: number;
    effectiveEventCount: number;
    correctionCount: number;
    privacyOverlayRevision: number;
    derivationVersion: number;
    rulesetVersionId: string;
    sourceEvidenceHash: string;
    effectiveHistoryHash: string;
    replayStateHash: string | null;
    statisticsHash: string | null;
    reportHash: string | null;
    exportHash: string | null;
  }>;
}>;

export type ReconcileGameDataInput = Readonly<{
  setup: AcceptedSetup;
  events: readonly AcceptedEvent[];
  presentation: BoxScorePresentation;
  privacyOverlayRevision: number;
  generatedAt: string;
  projection: ReconciliationProjectionEvidence | null;
  observations?: DataReconciliationObservations;
}>;

function digest(value: unknown): string {
  return `sha256:v1:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function reportEvidence(report: GameBoxScore) {
  const { generatedAt: _generatedAt, ...version } = report.version;
  void _generatedAt;
  return { ...report, version };
}

function rates(projection: GameStatisticsProjection) {
  const team = (side: "AWAY" | "HOME") => ({
    batting: {
      battingAverage: projection.teams[side].batting.battingAverage,
      onBasePercentage: projection.teams[side].batting.onBasePercentage,
      sluggingPercentage: projection.teams[side].batting.sluggingPercentage,
      onBasePlusSlugging: projection.teams[side].batting.onBasePlusSlugging,
    },
    pitching: {
      earnedRunAverage: projection.teams[side].pitching.earnedRunAverage,
      walksAndHitsPerInningPitched:
        projection.teams[side].pitching.walksAndHitsPerInningPitched,
    },
    fielding: {
      chances: projection.teams[side].fielding.chances,
      fieldingPercentage: projection.teams[side].fielding.fieldingPercentage,
    },
  });
  return {
    batting: projection.batting.map(({ playerId, side, rates }) => ({
      playerId,
      side,
      rates,
    })),
    pitching: projection.pitching.map(({ playerId, side, rates }) => ({
      playerId,
      side,
      rates,
    })),
    fielding: projection.fielding.map(({ playerId, side, rates }) => ({
      playerId,
      side,
      rates,
    })),
    teams: { AWAY: team("AWAY"), HOME: team("HOME") },
  };
}

const rateKeys = new Set([
  "battingAverage",
  "onBasePercentage",
  "sluggingPercentage",
  "onBasePlusSlugging",
  "earnedRunAverage",
  "walksAndHitsPerInningPitched",
  "chances",
  "fieldingPercentage",
]);

function teamCounters(projection: GameStatisticsProjection) {
  const counters = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !rateKeys.has(key)),
    );
  const team = (side: "AWAY" | "HOME") => ({
    batting: counters(projection.teams[side].batting),
    pitching: counters(projection.teams[side].pitching),
    fielding: counters(projection.teams[side].fielding),
  });
  return { AWAY: team("AWAY"), HOME: team("HOME") };
}

function playerCounters(projection: GameStatisticsProjection) {
  return {
    batting: projection.batting.map(({ playerId, side, counters }) => ({
      playerId,
      side,
      counters,
    })),
    pitching: projection.pitching.map(({ playerId, side, counters }) => ({
      playerId,
      side,
      counters,
    })),
    fielding: projection.fielding.map(({ playerId, side, counters }) => ({
      playerId,
      side,
      counters,
    })),
  };
}

function addFinding(
  findings: DataReconciliationFinding[],
  finding: Omit<DataReconciliationFinding, "context"> & {
    context?: DataReconciliationFinding["context"];
  },
) {
  findings.push({ ...finding, context: finding.context ?? {} });
}

function compareObservations(
  observations: DataReconciliationObservations,
  canonical: {
    state: GameState;
    statistics: GameStatisticsProjection;
    report: GameBoxScore;
    exportSummary: PortableGameSummary;
  },
  findings: DataReconciliationFinding[],
) {
  if (observations.replayState) {
    if (!equal(observations.replayState.score, canonical.state.score)) {
      addFinding(findings, {
        category: "SCORE",
        code: "REPLAY_SCORE_MISMATCH",
        severity: "BLOCKING",
        remediation: "REPLAY_SOURCE",
      });
    }
    const observedBaseOut = {
      inning: observations.replayState.inning,
      half: observations.replayState.half,
      outs: observations.replayState.outs,
      bases: observations.replayState.bases,
    };
    const canonicalBaseOut = {
      inning: canonical.state.inning,
      half: canonical.state.half,
      outs: canonical.state.outs,
      bases: canonical.state.bases,
    };
    if (!equal(observedBaseOut, canonicalBaseOut)) {
      addFinding(findings, {
        category: "OUTS_AND_RUNNERS",
        code: "REPLAY_BASE_OUT_MISMATCH",
        severity: "BLOCKING",
        remediation: "REPLAY_SOURCE",
      });
    }
    if (!equal(observations.replayState, canonical.state)) {
      addFinding(findings, {
        category: "REPLAY_STATE",
        code: "REPLAY_STATE_MISMATCH",
        severity: "BLOCKING",
        remediation: "ESCALATE_INTEGRITY",
      });
    }
  }

  if (observations.statistics) {
    if (
      !equal(
        observations.statistics.finalScore,
        canonical.statistics.finalScore,
      )
    ) {
      addFinding(findings, {
        category: "SCORE",
        code: "STATISTIC_SCORE_MISMATCH",
        severity: "BLOCKING",
        remediation: "REBUILD_PROJECTION",
      });
    }
    if (
      !equal(
        observations.statistics.inningLines,
        canonical.statistics.inningLines,
      )
    ) {
      addFinding(findings, {
        category: "SCORE",
        code: "INNING_LINE_MISMATCH",
        severity: "BLOCKING",
        remediation: "REBUILD_PROJECTION",
      });
    }
    if (
      !equal(
        playerCounters(observations.statistics),
        playerCounters(canonical.statistics),
      )
    ) {
      addFinding(findings, {
        category: "PLAYER_TOTALS",
        code: "PLAYER_TOTAL_MISMATCH",
        severity: "BLOCKING",
        remediation: "REBUILD_PROJECTION",
      });
    }
    if (
      !equal(
        teamCounters(observations.statistics),
        teamCounters(canonical.statistics),
      )
    ) {
      addFinding(findings, {
        category: "TEAM_TOTALS",
        code: "TEAM_TOTAL_MISMATCH",
        severity: "BLOCKING",
        remediation: "REBUILD_PROJECTION",
      });
    }
    if (!equal(rates(observations.statistics), rates(canonical.statistics))) {
      addFinding(findings, {
        category: "DERIVED_RATES",
        code: "DERIVED_RATE_MISMATCH",
        severity: "BLOCKING",
        remediation: "REBUILD_PROJECTION",
      });
    }
    if (
      observations.statistics.metadata.verificationStatus !==
        canonical.statistics.metadata.verificationStatus ||
      observations.statistics.metadata.lifecycleStatus !==
        canonical.statistics.metadata.lifecycleStatus
    ) {
      addFinding(findings, {
        category: "VERIFICATION",
        code: "VERIFICATION_STATE_MISMATCH",
        severity: "BLOCKING",
        remediation: "ESCALATE_INTEGRITY",
      });
    }
  }

  if (
    observations.boxScore &&
    !equal(
      reportEvidence(observations.boxScore),
      reportEvidence(canonical.report),
    )
  ) {
    addFinding(findings, {
      category: "REPORT",
      code: "REPORT_MISMATCH",
      severity: "BLOCKING",
      remediation: "REGENERATE_REPORT",
    });
  }
  if (
    observations.exportSummary &&
    !equal(observations.exportSummary, canonical.exportSummary)
  ) {
    addFinding(findings, {
      category: "EXPORT",
      code: "EXPORT_SUMMARY_MISMATCH",
      severity: "BLOCKING",
      remediation: "REGENERATE_EXPORT",
    });
  }
}

function lifecycleFinding(
  state: GameState,
  correctionCount: number,
  findings: DataReconciliationFinding[],
) {
  if (["READY", "IN_PROGRESS", "SUSPENDED"].includes(state.status)) {
    addFinding(findings, {
      category: "VERIFICATION",
      code: "GAME_NOT_COMPLETE",
      severity: "WARNING",
      remediation: "RESUME_OR_COMPLETE_GAME",
      context: { lifecycleStatus: state.status },
    });
  } else if (state.status === "ABANDONED" || state.status === "CANCELLED") {
    addFinding(findings, {
      category: "VERIFICATION",
      code: "GAME_TERMINATED_UNVERIFIED",
      severity: "WARNING",
      remediation: "REVIEW_TERMINATED_GAME",
      context: { lifecycleStatus: state.status },
    });
  } else if (state.status !== "VERIFIED") {
    addFinding(findings, {
      category: "VERIFICATION",
      code:
        correctionCount > 0
          ? "CORRECTED_HISTORY_REQUIRES_VERIFICATION"
          : "GAME_NOT_VERIFIED",
      severity: "WARNING",
      remediation: "REVERIFY_GAME",
      context: { lifecycleStatus: state.status },
    });
  }
}

function confidenceFor(
  state: GameState,
  correctionCount: number,
  findings: readonly DataReconciliationFinding[],
): DataConfidenceState {
  if (findings.some(({ severity }) => severity === "BLOCKING")) {
    return "INTEGRITY_FAILURE";
  }
  if (findings.some(({ code }) => code === "PROJECTION_STALE")) {
    return "STALE";
  }
  if (
    ["READY", "IN_PROGRESS", "SUSPENDED"].includes(state.status) ||
    findings.some(({ code }) => code === "PROJECTION_MISSING")
  ) {
    return "INCOMPLETE";
  }
  if (correctionCount > 0 && state.status !== "VERIFIED") {
    return "CORRECTED";
  }
  return state.status === "VERIFIED" ? "VERIFIED" : "CURRENT";
}

export function reconcileGameData(
  input: ReconcileGameDataInput,
): DataReconciliationReport {
  const findings: DataReconciliationFinding[] = [];
  const orderedEvents = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  let state: GameState | null = null;
  let statistics: GameStatisticsProjection | null = null;
  let report: GameBoxScore | null = null;
  let exportSummary: PortableGameSummary | null = null;
  let effectiveHistoryHash = digest([]);

  try {
    state = replayGame(input.setup, orderedEvents, {
      verifyEvidence: true,
    }).state;
    effectiveHistoryHash = digest(
      replayGameTimeline(input.setup, orderedEvents).steps.map((step) => ({
        effectiveEventId: step.effectiveEventId,
        sourceEventId: step.sourceEventId,
        targetEventId: step.targetEventId,
        sequence: step.sequence,
        schemaVersion: step.schemaVersion,
        body: step.body,
      })),
    );
  } catch {
    addFinding(findings, {
      category: "SOURCE_HISTORY",
      code: "SOURCE_EVIDENCE_INVALID",
      severity: "BLOCKING",
      remediation: "ESCALATE_INTEGRITY",
    });
  }

  if (state) {
    try {
      statistics = deriveGameStatistics({
        setup: input.setup,
        events: orderedEvents,
        privacyOverlayRevision: input.privacyOverlayRevision,
      });
    } catch {
      addFinding(findings, {
        category: "PLAYER_TOTALS",
        code: "STATISTIC_DERIVATION_FAILED",
        severity: "BLOCKING",
        remediation: "REBUILD_PROJECTION",
      });
    }
  }

  if (statistics) {
    try {
      const projectionCheckpoint =
        input.projection?.status === "CURRENT" &&
        input.projection.sourceRevision ===
          statistics.metadata.sourceRevision &&
        input.projection.privacyOverlayRevision ===
          input.privacyOverlayRevision &&
        input.projection.derivationVersion === STATISTIC_DERIVATION_VERSION
          ? {
              sourceRevision: input.projection.sourceRevision,
              privacyOverlayRevision: input.projection.privacyOverlayRevision,
              derivationVersion: input.projection.derivationVersion,
              status: "CURRENT" as const,
            }
          : null;
      report = buildGameBoxScore({
        setup: input.setup,
        events: orderedEvents,
        presentation: input.presentation,
        privacyOverlayRevision: input.privacyOverlayRevision,
        generatedAt: input.generatedAt,
        projectionCheckpoint,
      });
    } catch {
      addFinding(findings, {
        category: "REPORT",
        code: "REPORT_GENERATION_FAILED",
        severity: "BLOCKING",
        remediation: "REGENERATE_REPORT",
      });
    }
    exportSummary = portableGameSummary(statistics);
  }

  const sourceRevision = orderedEvents.at(-1)?.acceptedRevision ?? 0;
  const correctionCount = orderedEvents.filter(
    ({ eventType }) => eventType === "CorrectionApplied",
  ).length;
  if (state && state.sourceRevision !== sourceRevision) {
    addFinding(findings, {
      category: "EFFECTIVE_HISTORY",
      code: "EFFECTIVE_REVISION_MISMATCH",
      severity: "BLOCKING",
      remediation: "ESCALATE_INTEGRITY",
    });
  }

  if (!input.projection) {
    addFinding(findings, {
      category: "PROJECTION_FRESHNESS",
      code: "PROJECTION_MISSING",
      severity: "WARNING",
      remediation: "REBUILD_PROJECTION",
    });
  } else if (
    input.projection.status !== "CURRENT" ||
    input.projection.sourceRevision !== sourceRevision ||
    input.projection.privacyOverlayRevision !== input.privacyOverlayRevision ||
    input.projection.derivationVersion !== STATISTIC_DERIVATION_VERSION
  ) {
    addFinding(findings, {
      category: "PROJECTION_FRESHNESS",
      code: "PROJECTION_STALE",
      severity: "WARNING",
      remediation: "REBUILD_PROJECTION",
      context: {
        projectionSourceRevision: input.projection.sourceRevision,
        sourceRevision,
        projectionStatus: input.projection.status,
      },
    });
  }

  if (state && statistics && report && exportSummary) {
    lifecycleFinding(state, correctionCount, findings);
    compareObservations(
      input.observations ?? {},
      { state, statistics, report, exportSummary },
      findings,
    );
  }

  findings.sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.code.localeCompare(right.code) ||
      left.severity.localeCompare(right.severity),
  );
  const confidence = state
    ? confidenceFor(state, correctionCount, findings)
    : "INTEGRITY_FAILURE";
  return {
    version: DATA_RECONCILIATION_VERSION,
    confidence,
    freshness:
      confidence === "INTEGRITY_FAILURE"
        ? "UNKNOWN"
        : confidence === "STALE"
          ? "STALE"
          : confidence === "INCOMPLETE"
            ? "INCOMPLETE"
            : "CURRENT",
    blocking: findings.some(({ severity }) => severity === "BLOCKING"),
    findings,
    provenance: {
      accountId: input.setup.accountId,
      gameId: input.setup.gameId,
      setupSnapshotId: input.setup.id,
      setupRevision: input.setup.setupRevision,
      sourceRevision,
      effectiveEventCount: (() => {
        try {
          return resolveEffectiveEvents(orderedEvents).length;
        } catch {
          return 0;
        }
      })(),
      correctionCount,
      privacyOverlayRevision: input.privacyOverlayRevision,
      derivationVersion: STATISTIC_DERIVATION_VERSION,
      rulesetVersionId: input.setup.rulesetVersionId,
      sourceEvidenceHash: digest(
        orderedEvents.map((event) => ({
          id: event.id,
          sequence: event.sequence,
          acceptedRevision: event.acceptedRevision,
          payload: event.payload,
          preStateHash: event.preStateHash,
          postStateHash: event.postStateHash,
        })),
      ),
      effectiveHistoryHash,
      replayStateHash: state ? digest(state) : null,
      statisticsHash: statistics ? digest(statistics) : null,
      reportHash: report ? digest(reportEvidence(report)) : null,
      exportHash: exportSummary ? digest(exportSummary) : null,
    },
  };
}

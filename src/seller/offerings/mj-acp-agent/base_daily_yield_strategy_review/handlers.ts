import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  fetchAerodromeTop5SafePools,
  fetchBaseYieldOpportunities,
  type Scope,
  type TokenPreference,
} from "../connectors/baseYield.js";
import { POLICY } from "../connectors/policy.js";
import { chooseRecommendedAction } from "../connectors/strategy.js";

type RiskMode = "conservative" | "balanced";
type OutputMode = "user" | "debug";

type BaseDailyRequest = {
  chain: "base";
  budgetUSDC: string;
  maxLossPct: string;
  targetProfitPct: string;
  horizonDays: string;
  rebalanceCadence?: string;
  riskMode?: RiskMode;
  scope?: Scope;
  tokenPreference?: TokenPreference;
  outputMode?: OutputMode;
  notes?: string;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function normStr(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function asRequest(input: unknown): Partial<BaseDailyRequest> {
  return (typeof input === "object" && input !== null ? input : {}) as Partial<BaseDailyRequest>;
}

export function validateRequirements(request: unknown): ValidationResult {
  const req = asRequest(request);
  const chain = String(req.chain || "").toLowerCase();
  if (!chain) return { valid: false, reason: "Missing chain" };
  if (chain !== "base") return { valid: false, reason: "Only chain=base is supported in MVP" };

  const budget = toNum(req.budgetUSDC);
  const dd = toNum(req.maxLossPct);
  const tp = toNum(req.targetProfitPct);
  const horizon = toNum(req.horizonDays);

  if (budget === null || budget <= 0)
    return { valid: false, reason: "budgetUSDC must be a positive number" };
  if (dd === null || dd <= 0 || dd > 50)
    return { valid: false, reason: "maxLossPct must be between 0 and 50" };
  if (tp === null || tp <= 0 || tp > 200)
    return { valid: false, reason: "targetProfitPct must be between 0 and 200" };
  if (horizon === null || ![7, 14, 30].includes(horizon))
    return { valid: false, reason: "horizonDays must be one of: 7, 14, 30" };

  const scope = normStr(req.scope, "all").toLowerCase();
  if (!["aerodrome", "lending", "all"].includes(scope)) {
    return { valid: false, reason: "scope must be one of: aerodrome, lending, all" };
  }

  const riskMode = normStr(req.riskMode, "conservative").toLowerCase();
  if (!["conservative", "balanced"].includes(riskMode)) {
    return { valid: false, reason: "riskMode must be one of: conservative, balanced" };
  }

  const tokenPreference = normStr(req.tokenPreference, "USDC").toUpperCase();
  if (!["USDC", "ETH", "MIXED"].includes(tokenPreference)) {
    return { valid: false, reason: "tokenPreference must be one of: USDC, ETH, mixed" };
  }

  const outputMode = normStr(req.outputMode, "user").toLowerCase();
  if (!["user", "debug"].includes(outputMode)) {
    return { valid: false, reason: "outputMode must be one of: user, debug" };
  }

  return { valid: true };
}

export function requestPayment(_request: unknown): string {
  return "Request accepted";
}

export async function executeJob(request: unknown): Promise<ExecuteJobResult> {
  const req = asRequest(request);

  const budgetUSDC = Number(String(req.budgetUSDC).trim());
  const maxLossPct = Number(String(req.maxLossPct).trim());
  const targetProfitPct = Number(String(req.targetProfitPct).trim());
  const horizonDays = Number(String(req.horizonDays).trim());

  const riskMode = normStr(req.riskMode, "conservative").toLowerCase() as RiskMode;
  const scope = normStr(req.scope, "all").toLowerCase() as Scope;
  const tokenPreference = normStr(req.tokenPreference, "USDC").toUpperCase() as TokenPreference;
  const outputMode = normStr(req.outputMode, "user").toLowerCase() as OutputMode;
  const rebalanceCadence = normStr(req.rebalanceCadence, "daily");

  const slippageMaxPct =
    riskMode === "balanced"
      ? POLICY.SLIPPAGE_MAX_PCT_BALANCED
      : POLICY.SLIPPAGE_MAX_PCT_CONSERVATIVE;
  const positionMaxPctPerVenue =
    riskMode === "balanced"
      ? POLICY.POSITION_MAX_PCT_PER_VENUE_BALANCED
      : POLICY.POSITION_MAX_PCT_PER_VENUE_CONSERVATIVE;
  const positionMaxPctPerPool =
    riskMode === "balanced"
      ? POLICY.POSITION_MAX_PCT_PER_POOL_BALANCED
      : POLICY.POSITION_MAX_PCT_PER_POOL_CONSERVATIVE;
  const venues = scope === "all" ? ["aerodrome", "lending"] : [scope];

  const { opportunities, stats } = await fetchBaseYieldOpportunities({
    scope,
    tokenPreference,
    limit: 10,
  });
  const aerodromeTop5 = await fetchAerodromeTop5SafePools();
  const recommendedAction = chooseRecommendedAction({
    maxLossPct,
    targetProfitPct,
    horizonDays,
    opportunities,
  });

  const debugView = {
    recommendedAction,
    liveOpportunities: opportunities,
    selectionStats: stats,
  };

  const topPools = aerodromeTop5.slice(0, 3).map((p) => ({
    symbol: p.symbol,
    tvlUsd: p.tvlUsd,
    apy: p.apy,
    riskScore: p.riskScore,
    ilRisk: p.ilRisk,
  }));

  const userView = {
    action: recommendedAction.action,
    why: recommendedAction.rationale,
    chosen: recommendedAction.chosenCandidate
      ? {
          venue: recommendedAction.chosenCandidate.venue,
          symbol: recommendedAction.chosenCandidate.symbol,
          apy: recommendedAction.chosenCandidate.apy,
          tvlUsd: recommendedAction.chosenCandidate.tvlUsd,
          riskScore: recommendedAction.chosenCandidate.riskScore,
          ilRisk: recommendedAction.chosenCandidate.ilRisk,
        }
      : null,
    expectedPctInHorizon: recommendedAction.expectedPctInHorizon ?? null,
    topPools,
    guardrails: {
      maxLossPct,
      targetProfitPct,
      horizonDays,
      slippageMaxPct,
      maxPctPerVenue: positionMaxPctPerVenue,
      maxPctPerPool: positionMaxPctPerPool,
      rebalanceCadence,
    },
  };

  const deliverable = {
    version: "v2",
    chain: "base",
    offering: "base_daily_yield_strategy_review",
    dataSource: "defillama-yields",
    generatedAt: new Date().toISOString(),
    inputs: {
      budgetUSDC,
      maxLossPct,
      targetProfitPct,
      horizonDays,
      riskMode,
      scope,
      tokenPreference,
      rebalanceCadence,
      notes: req.notes || null,
      outputMode,
    },
    userView,
    ...(outputMode === "debug" ? { debugView } : {}),
    aerodromeTVLTop5Safe: aerodromeTop5,
    allocationTemplate: {
      venues,
      maxPctPerVenue: positionMaxPctPerVenue,
      maxPctPerPool: positionMaxPctPerPool,
      tokenPreference,
      suggestion:
        scope === "lending"
          ? { lending: 100 }
          : scope === "aerodrome"
            ? { aerodrome: 100 }
            : riskMode === "conservative"
              ? { lending: 70, aerodrome: 30 }
              : { lending: 50, aerodrome: 50 },
    },
    riskGates: {
      maxDrawdownPct: maxLossPct,
      targetProfitPct,
      slippageMaxPct,
      rebalanceCadence,
      disallowLeverage: true,
    },
    todayChecklist: [
      "Confirm Base network and sufficient ETH for gas.",
      "Review liveOpportunities and cap exposure by maxPctPerVenue/maxPctPerPool.",
      "Aerodrome entries must come from aerodromeTVLTop5Safe only.",
      "Record tx hashes and entry snapshot for tomorrow’s review.",
      "If drawdown > maxLossPct: force REDUCE/EXIT decision next cycle.",
    ],
    outputFormat: "json",
  };

  return {
    deliverable: {
      type: "json",
      value: deliverable,
    },
  };
}

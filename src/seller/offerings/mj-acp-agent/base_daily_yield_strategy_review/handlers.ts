import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  fetchAerodromeTop5SafePools,
  fetchBaseYieldOpportunities,
  type Scope,
  type TokenPreference,
} from "../connectors/baseYield.js";
import { chooseRecommendedAction } from "../connectors/strategy.js";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function normStr(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

export function validateRequirements(request: any): ValidationResult {
  const chain = String(request?.chain || "").toLowerCase();
  if (!chain) return { valid: false, reason: "Missing chain" };
  if (chain !== "base") return { valid: false, reason: "Only chain=base is supported in MVP" };

  const budget = toNum(request?.budgetUSDC);
  const dd = toNum(request?.maxLossPct);
  const tp = toNum(request?.targetProfitPct);
  const horizon = toNum(request?.horizonDays);

  if (budget === null || budget <= 0)
    return { valid: false, reason: "budgetUSDC must be a positive number" };
  if (dd === null || dd <= 0 || dd > 50)
    return { valid: false, reason: "maxLossPct must be between 0 and 50" };
  if (tp === null || tp <= 0 || tp > 200)
    return { valid: false, reason: "targetProfitPct must be between 0 and 200" };
  if (horizon === null || ![7, 14, 30].includes(horizon))
    return { valid: false, reason: "horizonDays must be one of: 7, 14, 30" };

  const scope = normStr(request?.scope, "all").toLowerCase();
  if (!["aerodrome", "lending", "all"].includes(scope)) {
    return { valid: false, reason: "scope must be one of: aerodrome, lending, all" };
  }

  const riskMode = normStr(request?.riskMode, "conservative").toLowerCase();
  if (!["conservative", "balanced"].includes(riskMode)) {
    return { valid: false, reason: "riskMode must be one of: conservative, balanced" };
  }

  const tokenPreference = normStr(request?.tokenPreference, "mixed").toUpperCase();
  if (!["USDC", "ETH", "MIXED"].includes(tokenPreference)) {
    return { valid: false, reason: "tokenPreference must be one of: USDC, ETH, mixed" };
  }

  return { valid: true };
}

export function requestPayment(_request: any): string {
  return "Request accepted";
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const budgetUSDC = Number(String(request?.budgetUSDC).trim());
  const maxLossPct = Number(String(request?.maxLossPct).trim());
  const targetProfitPct = Number(String(request?.targetProfitPct).trim());
  const horizonDays = Number(String(request?.horizonDays).trim());

  const riskMode = normStr(request?.riskMode, "conservative").toLowerCase();
  const scope = normStr(request?.scope, "all").toLowerCase() as Scope;
  const tokenPreference = normStr(
    request?.tokenPreference,
    "mixed"
  ).toUpperCase() as TokenPreference;
  const rebalanceCadence = normStr(request?.rebalanceCadence, "daily");

  const slippageMaxPct = riskMode === "balanced" ? 1.0 : 0.5;
  const positionMaxPctPerVenue = riskMode === "balanced" ? 60 : 50;
  const positionMaxPctPerPool = riskMode === "balanced" ? 35 : 25;
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

  const deliverable = {
    version: "v1",
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
      notes: request?.notes || null,
    },
    recommendedAction,
    liveOpportunities: opportunities,
    selectionStats: stats,
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

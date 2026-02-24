import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { fetchAerodromeTop5SafePools } from "../connectors/baseYield.js";
import { POLICY, RISKY_TOKEN_BLACKLIST } from "../connectors/policy.js";
import { chooseRecommendedAction } from "../connectors/strategy.js";

type RiskMode = "conservative" | "balanced";

type AerodromeDailyRequest = {
  chain: "base";
  budgetUSDC: string;
  maxLossPct: string;
  targetProfitPct: string;
  horizonDays: string;
  rebalanceCadence?: string;
  riskMode?: RiskMode;
  poolSelection?: string;
  notes?: string;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function pick<T>(v: T | undefined | null, fallback: T): T {
  return v === undefined || v === null ? fallback : v;
}

function asRequest(input: unknown): Partial<AerodromeDailyRequest> {
  return (
    typeof input === "object" && input !== null ? input : {}
  ) as Partial<AerodromeDailyRequest>;
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

  const riskMode = String(req.riskMode || "conservative").toLowerCase();
  if (!["conservative", "balanced"].includes(riskMode)) {
    return { valid: false, reason: "riskMode must be one of: conservative, balanced" };
  }

  return { valid: true };
}

export function requestPayment(_request: unknown): string {
  return "Request accepted";
}

export async function executeJob(request: unknown): Promise<ExecuteJobResult> {
  const req = asRequest(request);

  const riskMode = pick(String(req.riskMode || "conservative"), "conservative") as RiskMode;
  const poolSelection = pick(String(req.poolSelection || "tvl_top5_all"), "tvl_top5_all");
  const rebalanceCadence = pick(String(req.rebalanceCadence || "daily"), "daily");

  const budgetUSDC = Number(String(req.budgetUSDC).trim());
  const maxLossPct = Number(String(req.maxLossPct).trim());
  const targetProfitPct = Number(String(req.targetProfitPct).trim());
  const horizonDays = Number(String(req.horizonDays).trim());

  const top5SafePools = await fetchAerodromeTop5SafePools();
  const recommendation = chooseRecommendedAction({
    maxLossPct,
    targetProfitPct,
    horizonDays,
    opportunities: top5SafePools,
  });

  const deliverable = {
    version: "v1",
    protocol: "aerodrome",
    chain: "base",
    dataSource: "defillama-yields",
    generatedAt: new Date().toISOString(),
    inputs: {
      budgetUSDC,
      maxLossPct,
      targetProfitPct,
      horizonDays,
      riskMode,
      poolSelection,
      rebalanceCadence,
      notes: req.notes || null,
    },
    recommendation,
    top5PoolsByTVLSafe: top5SafePools,
    safetyFilters: {
      minAgeDays: 7,
      blacklistApplied: true,
      blacklistKeywords: [...RISKY_TOKEN_BLACKLIST],
    },
    riskGates: {
      maxDrawdownPct: maxLossPct,
      targetProfitPct,
      slippageMaxPct:
        riskMode === "balanced"
          ? POLICY.SLIPPAGE_MAX_PCT_BALANCED
          : POLICY.SLIPPAGE_MAX_PCT_CONSERVATIVE,
      positionMaxPctPerPool:
        riskMode === "balanced"
          ? POLICY.POSITION_MAX_PCT_PER_POOL_BALANCED
          : POLICY.POSITION_MAX_PCT_PER_POOL_CONSERVATIVE,
      rebalanceCadence,
    },
    todayChecklist: [
      "Confirm Base network and sufficient ETH for gas.",
      "Use top5PoolsByTVLSafe only (age >=7d and blacklist filter applied).",
      "If deploying: split budget across pools within positionMaxPctPerPool.",
      "Record entry snapshot (pool, amounts, txHash) for tomorrow's review.",
      "If DD breaches maxLossPct: switch to REDUCE/EXIT next cycle.",
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

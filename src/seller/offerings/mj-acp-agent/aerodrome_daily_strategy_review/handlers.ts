import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function pick<T>(v: T | undefined | null, fallback: T): T {
  return v === undefined || v === null ? fallback : v;
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

  return { valid: true };
}

export function requestPayment(_request: any): string {
  // This offering is configured as free (jobFee=0). This message is kept for compatibility.
  return "Request accepted";
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const riskMode = pick(String(request?.riskMode || "conservative"), "conservative");
  const poolSelection = pick(String(request?.poolSelection || "tvl_top5_all"), "tvl_top5_all");
  const rebalanceCadence = pick(String(request?.rebalanceCadence || "daily"), "daily");

  const budgetUSDC = Number(String(request?.budgetUSDC).trim());
  const maxLossPct = Number(String(request?.maxLossPct).trim());
  const targetProfitPct = Number(String(request?.targetProfitPct).trim());
  const horizonDays = Number(String(request?.horizonDays).trim());

  // MVP NOTE:
  // - We are not executing trades here.
  // - We are not yet fetching on-chain TVL Top5 automatically.
  // - Deliverable is a structured strategy brief and execution checklist.

  const deliverable = {
    version: "v0",
    protocol: "aerodrome",
    chain: "base",
    inputs: {
      budgetUSDC,
      maxLossPct,
      targetProfitPct,
      horizonDays,
      riskMode,
      poolSelection,
      rebalanceCadence,
      notes: request?.notes || null,
    },
    recommendation: {
      action: "HOLD",
      rationale: [
        "MVP produces an execution-lite daily plan. For now, we default to HOLD unless a pool list + metrics feed is provided.",
        "Next iteration will compute Top5 pools by TVL and recommend DEPLOY/REDUCE/EXIT based on risk gates.",
      ],
    },
    riskGates: {
      maxDrawdownPct: maxLossPct,
      targetProfitPct,
      slippageMaxPct: riskMode === "balanced" ? 1.0 : 0.5,
      positionMaxPctPerPool: riskMode === "balanced" ? 35 : 25,
      rebalanceCadence,
    },
    todayChecklist: [
      "Confirm Base network and sufficient ETH for gas.",
      "Check Aerodrome top pools list (TVL) and verify token contracts are reputable.",
      "If deploying: split budget across pools within positionMaxPctPerPool.",
      "Record entry snapshot (pool, amounts, txHash) for tomorrow's review.",
      "If DD breaches maxLossPct: propose reduction/exit next cycle.",
    ],
    requiredNextDataForAutomation: [
      "Top5 pools by TVL (pool addresses) on Aerodrome (Base)",
      "Per-pool TVL, fees APR, incentive APR, and 24h volatility proxies",
      "User wallet holdings (read-only) for PnL / drawdown estimation",
    ],
    outputFormat: "json",
  };

  return { deliverable };
}

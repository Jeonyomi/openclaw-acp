import type { YieldOpportunity } from "./baseYield.js";

export type RecommendedAction = "HOLD" | "DEPLOY" | "REDUCE" | "EXIT";

export function chooseRecommendedAction(params: {
  maxLossPct: number;
  targetProfitPct: number;
  horizonDays: number;
  opportunities: YieldOpportunity[];
}): { action: RecommendedAction; rationale: string[] } {
  const top = params.opportunities[0];
  if (!top) {
    return {
      action: "HOLD",
      rationale: ["No eligible opportunities passed the safety and liquidity filters."],
    };
  }

  const expectedPctInHorizon = (top.apy * params.horizonDays) / 365;

  if (params.maxLossPct <= 0.8 || top.riskScore >= 85) {
    return {
      action: "EXIT",
      rationale: [
        "Risk exceeds conservative guardrails (very tight DD or high risk score).",
        `Top risk score: ${top.riskScore}/100.`,
      ],
    };
  }

  if (params.maxLossPct <= 1.5) {
    return {
      action: "REDUCE",
      rationale: [
        `Tight DD gate (${params.maxLossPct}%) suggests de-risking over fresh deployment.`,
        `Top opportunity risk score is ${top.riskScore}/100.`,
      ],
    };
  }

  if (expectedPctInHorizon >= params.targetProfitPct && top.riskScore <= 75) {
    return {
      action: "DEPLOY",
      rationale: [
        `Top APY implies ~${expectedPctInHorizon.toFixed(2)}% over ${params.horizonDays}d (target ${params.targetProfitPct}%).`,
        `Risk score ${top.riskScore}/100 is within the deployment threshold.`,
      ],
    };
  }

  if (expectedPctInHorizon >= params.targetProfitPct) {
    return {
      action: "HOLD",
      rationale: [
        `Top APY meets TP gate (~${expectedPctInHorizon.toFixed(2)}% over ${params.horizonDays}d), but risk score ${top.riskScore}/100 is too high for deployment.`,
        "Wait for safer conditions or choose a lower-risk venue/pool.",
      ],
    };
  }

  return {
    action: "HOLD",
    rationale: [
      `Top APY implies ~${expectedPctInHorizon.toFixed(2)}% over ${params.horizonDays}d, below TP gate (${params.targetProfitPct}%).`,
      "Wait for better risk-adjusted entry.",
    ],
  };
}

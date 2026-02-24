import axios from "axios";

export type Scope = "aerodrome" | "lending" | "all";
export type TokenPreference = "USDC" | "ETH" | "MIXED";

export interface YieldOpportunity {
  venue: string;
  poolId: string;
  symbol: string;
  apy: number;
  tvlUsd: number;
  riskScore: number;
  ageDays: number;
  ilRisk: string;
}

export interface YieldSelectionStats {
  total: number;
  afterChainFilter: number;
  afterScopeFilter: number;
  afterTokenFilter: number;
  excludedByApyCap: number;
  excludedByMinTvl: number;
  returned: number;
}

interface DefiLlamaPool {
  chain?: string;
  project?: string;
  symbol?: string;
  tvlUsd?: number;
  apy?: number;
  pool?: string;
  count?: number;
  ilRisk?: string;
}

const YIELDS_ENDPOINT = "https://yields.llama.fi/pools";
const LENDING_PROJECTS = new Set(["aave-v3", "morpho-blue", "moonwell"]);
import { POLICY, RISKY_TOKEN_BLACKLIST } from "./policy.js";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function containsBlacklistedToken(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return RISKY_TOKEN_BLACKLIST.some((token) => upper.includes(token));
}

function matchesScope(project: string, scope: Scope): boolean {
  const p = project.toLowerCase();
  if (scope === "all") return p.includes("aerodrome") || LENDING_PROJECTS.has(p);
  if (scope === "aerodrome") return p.includes("aerodrome");
  return LENDING_PROJECTS.has(p);
}

function matchesTokenPreference(symbol: string, tokenPreference: TokenPreference): boolean {
  if (tokenPreference === "MIXED") return true;
  const upper = symbol.toUpperCase();
  return upper.includes(tokenPreference);
}

function toVenue(project: string): string {
  const p = project.toLowerCase();
  if (p.includes("aerodrome")) return "aerodrome";
  return p;
}

function computeRiskScore(pool: DefiLlamaPool): number {
  const apy = Number(pool.apy ?? 0);
  const tvl = Number(pool.tvlUsd ?? 0);
  const ageDays = Number(pool.count ?? 0);
  const ilRisk = String(pool.ilRisk ?? "").toLowerCase();

  let risk = 50;
  risk += ilRisk === "yes" ? 20 : 0;
  // Higher APY tends to be riskier (especially for small/new pools).
  risk += apy >= 100 ? 25 : apy >= 40 ? 15 : apy >= 20 ? 8 : 2;
  risk += tvl < 5_000_000 ? 10 : tvl < 20_000_000 ? 5 : 0;
  risk += ageDays < 30 ? 10 : ageDays < 90 ? 5 : 0;

  return Math.round(clamp(risk, 1, 100));
}

function computeOpportunityScore(o: { apy: number; tvlUsd: number; riskScore: number }): number {
  // Risk-adjusted ranking: prefer big TVL + decent APY + low riskScore.
  // - cap APY contribution so outliers don't dominate.
  // - TVL contribution is log-scaled.
  const apyCapped = clamp(o.apy, 0, 200);
  const tvlLog = Math.log10(Math.max(1, o.tvlUsd));
  const score = apyCapped * 0.6 + tvlLog * 10 - o.riskScore * 0.7;
  return score;
}

async function fetchPools(): Promise<DefiLlamaPool[]> {
  const response = await axios.get<{ data: DefiLlamaPool[] }>(YIELDS_ENDPOINT, { timeout: 20_000 });
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

export async function fetchBaseYieldOpportunities(params: {
  scope: Scope;
  tokenPreference: TokenPreference;
  limit?: number;
}): Promise<{ opportunities: YieldOpportunity[]; stats: YieldSelectionStats }> {
  const pools = await fetchPools();
  const limit = params.limit ?? 10;

  const total = pools.length;
  const byChain = pools.filter((pool) => String(pool.chain ?? "").toLowerCase() === "base");
  const byScope = byChain.filter((pool) => matchesScope(String(pool.project ?? ""), params.scope));
  const byToken = byScope.filter((pool) =>
    matchesTokenPreference(String(pool.symbol ?? ""), params.tokenPreference)
  );

  const excludedByApyCap = byToken.filter(
    (pool) => Number(pool.apy ?? 0) > POLICY.APY_CAP_PCT
  ).length;
  const excludedByMinTvl = byToken.filter(
    (pool) => Number(pool.tvlUsd ?? 0) < POLICY.MIN_TVL_USD
  ).length;

  const opportunities = byToken
    // Base safety: avoid extreme APY outliers and tiny pools.
    .filter((pool) => Number(pool.apy ?? 0) > 0)
    .filter((pool) => Number(pool.apy ?? 0) <= POLICY.APY_CAP_PCT)
    .filter((pool) => Number(pool.tvlUsd ?? 0) >= POLICY.MIN_TVL_USD)
    .map((pool) => {
      const apy = Number(pool.apy ?? 0);
      const tvlUsd = Number(pool.tvlUsd ?? 0);
      const riskScore = computeRiskScore(pool);
      const o = {
        venue: toVenue(String(pool.project ?? "unknown")),
        poolId: String(pool.pool ?? "unknown"),
        symbol: String(pool.symbol ?? "UNKNOWN"),
        apy,
        tvlUsd,
        ageDays: Number(pool.count ?? 0),
        ilRisk: String(pool.ilRisk ?? "unknown"),
        riskScore,
      };
      return { ...o, _score: computeOpportunityScore(o) };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest);

  const stats: YieldSelectionStats = {
    total,
    afterChainFilter: byChain.length,
    afterScopeFilter: byScope.length,
    afterTokenFilter: byToken.length,
    excludedByApyCap,
    excludedByMinTvl,
    returned: opportunities.length,
  };

  return { opportunities, stats };
}

export async function fetchAerodromeTop5SafePools(): Promise<YieldOpportunity[]> {
  const pools = await fetchPools();

  return pools
    .filter((pool) => String(pool.chain ?? "").toLowerCase() === "base")
    .filter((pool) =>
      String(pool.project ?? "")
        .toLowerCase()
        .includes("aerodrome")
    )
    .filter((pool) => Number(pool.tvlUsd ?? 0) > 0)
    .filter((pool) => Number(pool.count ?? 0) >= 7)
    .filter((pool) => !containsBlacklistedToken(String(pool.symbol ?? "")))
    .map((pool) => ({
      venue: "aerodrome",
      poolId: String(pool.pool ?? "unknown"),
      symbol: String(pool.symbol ?? "UNKNOWN"),
      apy: Number(pool.apy ?? 0),
      tvlUsd: Number(pool.tvlUsd ?? 0),
      ageDays: Number(pool.count ?? 0),
      ilRisk: String(pool.ilRisk ?? "unknown"),
      riskScore: computeRiskScore(pool),
    }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, 5);
}

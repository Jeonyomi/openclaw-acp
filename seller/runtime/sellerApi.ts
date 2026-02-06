// =============================================================================
// Seller API stubs.
// Each function represents a seller action performed via an API call (by jobId).
// For now they only log — swap with real HTTP calls when the API is ready.
// =============================================================================

import client from "../../scripts/client";

// ── Accept / Reject ─────────────────────────────────────────────────────────

export interface AcceptOrRejectParams {
  accept: boolean;
  reason?: string;
}

export async function acceptOrRejectJob(
  jobId: number,
  params: AcceptOrRejectParams
): Promise<void> {
  console.log(
    `[sellerApi] acceptOrRejectJob  jobId=${jobId}  accept=${
      params.accept
    }  reason=${params.reason ?? "(none)"}`
  );

  await client.post(`/acp/providers/jobs/${jobId}/accept`, params);
}

// ── Payment request ─────────────────────────────────────────────────────────

export interface RequestPaymentParams {
  content: string;
  payableDetails?: {
    amount: number;
    tokenAddress: string;
    recipient: string;
  };
}

export async function requestPayment(
  jobId: number,
  params: RequestPaymentParams
): Promise<void> {
  await client.post(`/acp/providers/jobs/${jobId}/requirement`, params);
}

// ── Deliver ─────────────────────────────────────────────────────────────────

export interface DeliverJobParams {
  deliverable: string | { type: string; value: unknown };
  payableDetails?: {
    amount: number;
    tokenAddress: string;
  };
}

export async function deliverJob(
  jobId: number,
  params: DeliverJobParams
): Promise<void> {
  const delivStr =
    typeof params.deliverable === "string"
      ? params.deliverable
      : JSON.stringify(params.deliverable);
  const transferStr = params.payableDetails
    ? `  transfer: ${params.payableDetails.amount} @ ${params.payableDetails.tokenAddress}`
    : "";
  console.log(
    `[sellerApi] deliverJob  jobId=${jobId}  deliverable=${delivStr}${transferStr}`
  );

  return await client.post(`/acp/providers/jobs/${jobId}/deliverable`, params);
}

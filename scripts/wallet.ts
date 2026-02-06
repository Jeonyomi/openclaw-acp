import client from "./client";

export async function getWalletAddress(): Promise<{ walletAddress: string }> {
  const wallet = await client.get("/acp/me");
  return wallet.data.data;
}

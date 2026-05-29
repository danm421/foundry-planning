import type { GrowthSource } from "./allocation";

/** A holding row as returned by the enriched GET /holdings (Task 1). Numeric
 *  DB columns arrive as strings; the client keeps them as strings and parses
 *  at the display/rollup boundary (see holdings-display.ts). */
export interface HoldingRow {
  id: string;
  accountId: string;
  securityId: string | null;
  displayTicker: string | null;
  displayName: string | null;
  shares: string;
  price: string;
  priceAsOf: string | null;
  costBasis: string;
  sortOrder: number;
  notes: string | null;
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
  needsReview: boolean;
}

export interface HoldingCreateInput {
  securityId?: string | null;
  displayTicker?: string | null;
  displayName?: string | null;
  shares: number;
  price: number;
  priceAsOf?: string | null;
  costBasis: number;
  sortOrder?: number;
  notes?: string | null;
}

export type HoldingUpdateInput = Partial<HoldingCreateInput>;

export interface ClassifyResult {
  security: { id: string; name: string | null; securityType: string | null } | null;
  weights: { slug: string; weight: number }[];
}

const base = (clientId: string, accountId: string) =>
  `/api/clients/${clientId}/accounts/${accountId}/holdings`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listHoldings(clientId: string, accountId: string): Promise<HoldingRow[]> {
  return json(await fetch(base(clientId, accountId)));
}

export async function createHolding(
  clientId: string, accountId: string, input: HoldingCreateInput,
): Promise<HoldingRow> {
  return json(await fetch(base(clientId, accountId), jsonInit("POST", input)));
}

export async function updateHolding(
  clientId: string, accountId: string, holdingId: string, patch: HoldingUpdateInput,
): Promise<HoldingRow> {
  return json(await fetch(`${base(clientId, accountId)}/${holdingId}`, jsonInit("PUT", patch)));
}

export async function deleteHolding(
  clientId: string, accountId: string, holdingId: string,
): Promise<void> {
  await json(await fetch(`${base(clientId, accountId)}/${holdingId}`, { method: "DELETE" }));
}

export async function setHoldingOverride(
  clientId: string, accountId: string, holdingId: string,
  overrides: { assetClassId: string; weight: number }[],
): Promise<void> {
  await json(await fetch(`${base(clientId, accountId)}/${holdingId}/override`, jsonInit("PUT", { overrides })));
}

export async function classifyTicker(
  clientId: string, accountId: string, ticker: string,
): Promise<ClassifyResult> {
  // The route is fail-soft (always 200 with { security:null, weights:[] } on
  // miss/error), so this only throws on transport/5xx failures.
  return json(await fetch(`${base(clientId, accountId)}/classify`, jsonInit("POST", { ticker })));
}

export async function setAccountGrowthSource(
  clientId: string, accountId: string, growthSource: GrowthSource,
): Promise<void> {
  await json(
    await fetch(`/api/clients/${clientId}/accounts/${accountId}`, jsonInit("PUT", { growthSource })),
  );
}

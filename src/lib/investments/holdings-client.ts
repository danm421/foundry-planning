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
  marketValue: string | null;
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
  marketValue?: number | null;
  sortOrder?: number;
  notes?: string | null;
}

export type HoldingUpdateInput = Partial<HoldingCreateInput>;

export interface ClassifyResult {
  security: { id: string; name: string | null; securityType: string | null } | null;
  weights: { slug: string; weight: number }[];
}

export interface QuoteResult {
  price: number;
  asOf: string;
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

/** Fetch the latest EOD close for a ticker. Returns null on a miss or any
 *  transport error — callers leave the price field untouched on null. */
export async function getQuote(
  clientId: string, accountId: string, ticker: string,
): Promise<QuoteResult | null> {
  try {
    const url = `${base(clientId, accountId)}/quote?ticker=${encodeURIComponent(ticker.trim().toUpperCase())}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { price: number | null; asOf?: string };
    if (typeof body.price !== "number" || typeof body.asOf !== "string") return null;
    return { price: body.price, asOf: body.asOf };
  } catch {
    return null;
  }
}

export interface HoldingRefreshSummary {
  holdingsConsidered: number;
  holdingsUpdated: number;
  uniqueTickers: number;
  tickersPriced: number;
  tickersMissing: string[];
  accountsResynced: number;
  resyncFailures: { accountId: string; message: string }[];
}

/** Manually refresh stored prices for ALL of a client's tickered holdings
 *  (across every account/scenario). Throws on transport/non-2xx via json(). */
export async function refreshClientHoldingPrices(
  clientId: string,
): Promise<HoldingRefreshSummary> {
  return json(
    await fetch(`/api/clients/${clientId}/holdings/refresh`, { method: "POST" }),
  );
}

export async function setAccountGrowthSource(
  clientId: string, accountId: string, growthSource: GrowthSource,
): Promise<void> {
  await json(
    await fetch(`/api/clients/${clientId}/accounts/${accountId}`, jsonInit("PUT", { growthSource })),
  );
}

export async function setAccountDeriveFromHoldings(
  clientId: string, accountId: string, deriveFromHoldings: boolean,
): Promise<void> {
  await json(
    await fetch(`/api/clients/${clientId}/accounts/${accountId}`, jsonInit("PUT", { deriveFromHoldings })),
  );
}

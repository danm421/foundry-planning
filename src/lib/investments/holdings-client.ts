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
  /** Name resolved for DISPLAY only, when the ticker could not be classified
   *  into a persisted security row. No id, no weights — see lookup-name.ts. */
  displayName?: string | null;
  weights: { slug: string; weight: number }[];
}

export interface QuoteResult {
  price: number;
  asOf: string;
}

/** One row of the ticker picker. Mirrors the server's `SecuritySearchHit`;
 *  `securityType` stays a plain string here so the client bundle doesn't pull
 *  in the classification module. */
export interface SecuritySearchHit {
  ticker: string;
  name: string;
  exchange: string;
  securityType: string;
  /** Absent when the quote feed can't price this symbol — which is a different
   *  thing from a price of zero, and is rendered as such. */
  price?: number;
}

export interface SecuritySearchResult {
  hits: SecuritySearchHit[];
  /** Set when the typed name found nothing and a widened query was used
   *  instead, so the picker can say so rather than show rows that look wrong. */
  relaxedTo: string | null;
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

/** Search securities by NAME or ticker — the path for a statement that names a
 *  fund without giving its symbol. Unlike `getQuote`/`classifyTicker` this
 *  throws on failure: the picker has to distinguish "nothing matches" from
 *  "the search is down", and only one of those is the advisor's problem. */
export async function searchSecurities(
  clientId: string, query: string, signal?: AbortSignal,
): Promise<SecuritySearchResult> {
  // Client-scoped, not under an account: the answer is reference data and has
  // nothing to do with which account the holding lands in.
  const url = `/api/clients/${clientId}/holdings/search?q=${encodeURIComponent(query.trim())}`;
  const body = await json<{ results?: SecuritySearchHit[]; relaxedTo?: string | null }>(
    await fetch(url, { signal }),
  );
  return { hits: body.results ?? [], relaxedTo: body.relaxedTo ?? null };
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

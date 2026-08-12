/**
 * Target resolution in `loadRebalanceInputs`.
 *
 * The seam under test is how each target branch turns a target into holdings +
 * asset-class weights. A saved fund portfolio always stores `display_ticker`
 * but only sometimes stores `security_id` (the builder's write path never fills
 * it in), so the branch has to resolve by TICKER — and fail loud on a ticker it
 * genuinely can't classify, never quietly emit an empty proposed portfolio.
 *
 * Only IO is mocked: the DB (table-routed in-memory fixtures) and the two
 * classification boundaries. `resolveTargetAllocations` runs for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const ACCOUNT_ID = "33333333-3333-3333-3333-333333333333";
const PORTFOLIO_ID = "44444444-4444-4444-4444-444444444444";

const AC_US_EQUITY = "aaaaaaaa-0000-0000-0000-000000000001";
const AC_COMMODITIES = "aaaaaaaa-0000-0000-0000-000000000002";

const SEC_VTI = "bbbbbbbb-0000-0000-0000-000000000001";
const SEC_GLD = "bbbbbbbb-0000-0000-0000-000000000002";
const SEC_VOO = "bbbbbbbb-0000-0000-0000-000000000003";

type Row = Record<string, unknown>;

const dbState: Record<string, Row[]> = {
  asset_classes: [],
  asset_class_correlations: [],
  cma_settings: [],
  accounts: [],
  ticker_portfolios: [],
  ticker_portfolio_holdings: [],
  security_asset_class_weights: [],
  security_price_history: [],
};

// --- Mocks: IO only -------------------------------------------------------

vi.mock("@/db", () => {
  const nameOf = (t: unknown): string => {
    try {
      return getTableName(t as Parameters<typeof getTableName>[0]);
    } catch {
      return "";
    }
  };
  // The mock ignores WHERE conditions — tests control what the DB "returns" by
  // populating dbState, exactly as the projection loader tests do.
  const makeResult = (rows: unknown[]): Record<string, unknown> => ({
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    where: () => makeResult(rows),
    limit: () => makeResult(rows),
    orderBy: () => makeResult(rows),
    innerJoin: () => makeResult(rows),
  });
  return {
    db: {
      select: () => ({
        from: (t: unknown) => makeResult(dbState[nameOf(t)] ?? []),
      }),
    },
  };
});

/** Ticker → the firm's already-classified security. Anything absent is unclassifiable. */
const cachedSecurities: Record<
  string,
  { id: string; slugWeights: { slug: string; weight: number }[] }
> = {};

vi.mock("@/lib/investments/classification/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investments/classification/persist")>()),
  getSecurityByTicker: async (ticker: string) => {
    const hit = cachedSecurities[ticker.toUpperCase()];
    if (!hit) return null;
    return {
      security: { id: hit.id },
      weights: hit.slugWeights.map((w) => ({
        assetClassSlug: w.slug,
        weight: String(w.weight),
      })),
    };
  },
}));

// No live classifier in these tests: a ticker the firm hasn't classified is unresolvable.
vi.mock("@/lib/investments/classification/classify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investments/classification/classify")>()),
  classifySecurity: async () => null,
}));

vi.mock("@/lib/investments/load-enriched-holdings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investments/load-enriched-holdings")>()),
  loadEnrichedHoldings: async () => new Map(),
}));

import { loadRebalanceInputs } from "./load-inputs";
import { UnclassifiableTickerError } from "./resolve-target";
import type { RebalanceRequest } from "./types";

// --- Fixtures -------------------------------------------------------------

const assetClassRow = (id: string, slug: string, name: string): Row => ({
  id,
  firmId: FIRM_ID,
  slug,
  name,
  geometricReturn: "0.07",
  arithmeticMean: "0.08",
  volatility: "0.15",
  pctOrdinaryIncome: "0",
  pctLtCapitalGains: "0",
  pctQualifiedDividends: "0",
  pctTaxExempt: "0",
});

/** A stored fund-portfolio holding. `securityId` is null the way the builder writes it. */
const holdingRow = (
  displayTicker: string,
  weight: string,
  securityId: string | null = null,
): Row => ({
  id: `holding-${displayTicker}`,
  tickerPortfolioId: PORTFOLIO_ID,
  securityId,
  displayTicker,
  weight,
  sortOrder: 0,
});

function seedFirm() {
  for (const key of Object.keys(dbState)) dbState[key] = [];
  for (const key of Object.keys(cachedSecurities)) delete cachedSecurities[key];

  dbState.asset_classes = [
    assetClassRow(AC_US_EQUITY, "us_large_cap", "US Large Cap"),
    assetClassRow(AC_COMMODITIES, "commodities", "Commodities"),
  ];
  dbState.accounts = [{ id: ACCOUNT_ID, category: "retirement" }];
  dbState.ticker_portfolios = [{ id: PORTFOLIO_ID, firmId: FIRM_ID, name: "Test portfolio" }];

  cachedSecurities.VTI = { id: SEC_VTI, slugWeights: [{ slug: "us_large_cap", weight: 1 }] };
  cachedSecurities.GLD = { id: SEC_GLD, slugWeights: [{ slug: "commodities", weight: 1 }] };
  cachedSecurities.VOO = { id: SEC_VOO, slugWeights: [{ slug: "us_large_cap", weight: 1 }] };
}

const storedPortfolioRequest: RebalanceRequest = {
  accountIds: [ACCOUNT_ID],
  target: { portfolioId: PORTFOLIO_ID },
};

// --- Tests ----------------------------------------------------------------

describe("loadRebalanceInputs — saved fund portfolio as the target", () => {
  beforeEach(() => {
    seedFirm();
  });

  it("resolves the target by ticker when the stored holdings carry no security_id", async () => {
    dbState.ticker_portfolio_holdings = [
      holdingRow("VTI", "0.5"),
      holdingRow("GLD", "0.2"),
      holdingRow("VOO", "0.3"),
    ];

    const inputs = await loadRebalanceInputs(CLIENT_ID, FIRM_ID, storedPortfolioRequest);

    expect(inputs.targetHoldings).toEqual([
      { securityId: SEC_VTI, ticker: "VTI", weight: 0.5 },
      { securityId: SEC_GLD, ticker: "GLD", weight: 0.2 },
      { securityId: SEC_VOO, ticker: "VOO", weight: 0.3 },
    ]);
    // VTI 0.5 + VOO 0.3 land in US Large Cap; GLD 0.2 in Commodities.
    expect(
      [...inputs.targetAllocations].sort((a, b) => a.assetClassId.localeCompare(b.assetClassId)),
    ).toEqual([
      { assetClassId: AC_US_EQUITY, weight: 0.8 },
      { assetClassId: AC_COMMODITIES, weight: 0.2 },
    ]);
  });

  it("fails loud when a stored ticker resolves via neither path", async () => {
    dbState.ticker_portfolio_holdings = [
      holdingRow("VTI", "0.5"),
      holdingRow("NOTATICKER", "0.5"),
    ];

    await expect(
      loadRebalanceInputs(CLIENT_ID, FIRM_ID, storedPortfolioRequest),
    ).rejects.toBeInstanceOf(UnclassifiableTickerError);
  });

  it("resolves the same way when the stored holdings do carry a security_id", async () => {
    dbState.ticker_portfolio_holdings = [
      holdingRow("VTI", "0.5", SEC_VTI),
      holdingRow("GLD", "0.2", SEC_GLD),
      holdingRow("VOO", "0.3", SEC_VOO),
    ];

    const inputs = await loadRebalanceInputs(CLIENT_ID, FIRM_ID, storedPortfolioRequest);

    expect(inputs.targetHoldings).toEqual([
      { securityId: SEC_VTI, ticker: "VTI", weight: 0.5 },
      { securityId: SEC_GLD, ticker: "GLD", weight: 0.2 },
      { securityId: SEC_VOO, ticker: "VOO", weight: 0.3 },
    ]);
    expect(inputs.targetAllocations).toHaveLength(2);
  });
});

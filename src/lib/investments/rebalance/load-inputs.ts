import { db } from "@/db";
import {
  accounts as accountsTable,
  assetClasses as assetClassesTable,
  assetClassCorrelations,
  cmaSettings,
  securityPriceHistory,
  tickerPortfolioHoldings,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { loadEnrichedHoldings } from "@/lib/investments/load-enriched-holdings";
import { loadTickerPortfolioAllocations } from "@/lib/investments/load-ticker-portfolio-allocations";
import { firmSlugToAssetClassId } from "@/lib/investments/holdings-rollup";
import { monthlyReturns, type MonthlyReturn } from "@/lib/cma-stats";
import { loadClientData } from "@/lib/projection/load-client-data";
import { runProjection } from "@/engine/projection";
import { classifySecurity } from "@/lib/investments/classification/classify";
import { upsertClassifiedSecurity } from "@/lib/investments/classification/persist";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { RebalanceInputs, CurrentHolding, AssetClassFull } from "./assemble";
import type { RebalanceRequest } from "./types";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

interface PriceRow {
  securityId: string;
  month: string;
  adjClose: number;
}

/** Pure: group price rows by security and convert to monthly returns. */
export function barsToReturnsBySecurity(
  rows: readonly PriceRow[],
): Map<string, MonthlyReturn[]> {
  const bySecurity = new Map<string, PriceRow[]>();
  for (const row of rows) {
    const list = bySecurity.get(row.securityId) ?? [];
    list.push(row);
    bySecurity.set(row.securityId, list);
  }
  const out = new Map<string, MonthlyReturn[]>();
  for (const [securityId, list] of bySecurity) {
    const sorted = [...list].sort((a, b) => a.month.localeCompare(b.month));
    out.set(
      securityId,
      monthlyReturns(sorted.map((r) => ({ date: r.month, adjClose: r.adjClose }))),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Private IO helpers
// ---------------------------------------------------------------------------

async function loadReturns(securityIds: string[]): Promise<Map<string, MonthlyReturn[]>> {
  if (securityIds.length === 0) return new Map();
  const rows = await db
    .select({
      securityId: securityPriceHistory.securityId,
      month: securityPriceHistory.month,
      adjustedClose: securityPriceHistory.adjustedClose,
    })
    .from(securityPriceHistory)
    .where(inArray(securityPriceHistory.securityId, securityIds));
  return barsToReturnsBySecurity(
    rows.map((r) => ({
      securityId: r.securityId,
      month: r.month,
      adjClose: parseFloat(r.adjustedClose),
    })),
  );
}

async function classifyTickerForRebalance(
  ticker: string,
): Promise<{ securityId: string | null; slugWeights: { slug: string; weight: number }[] }> {
  const classified = await classifySecurity(ticker);
  if (!classified) return { securityId: null, slugWeights: [] };
  const securityId = await upsertClassifiedSecurity(classified);

  // Best-effort: populate price history so the realized backtest can include
  // this new ticker. Mirrors the store pattern in ticker-portfolio-compute.ts.
  try {
    const asOfMonth = new Date().toISOString().slice(0, 7);
    const { loadTickerMonthlyReturns } = await import("@/lib/ticker-history");
    const store = {
      readBars: async () => {
        const rows = await db
          .select()
          .from(securityPriceHistory)
          .where(eq(securityPriceHistory.securityId, securityId));
        return rows.map((r) => ({
          date: r.month,
          adjClose: parseFloat(r.adjustedClose),
        }));
      },
      upsertBars: async (_t: string, bars: { date: string; adjClose: number }[]) => {
        if (bars.length === 0) return;
        await db
          .insert(securityPriceHistory)
          .values(
            bars.map((b) => ({
              securityId,
              month: `${b.date.slice(0, 7)}-01`,
              adjustedClose: String(b.adjClose),
            })),
          )
          .onConflictDoNothing();
      },
    };
    await loadTickerMonthlyReturns(ticker, { asOfMonth, store });
  } catch {
    // soft-fail — best-effort; batched loadReturns() reads cached rows afterward
  }

  // classified.weights is AssetClassWeightBySlug[] = { slug, weight }[]
  return { securityId, slugWeights: classified.weights };
}

// ---------------------------------------------------------------------------
// Tax context
// ---------------------------------------------------------------------------

// niitThreshold has no head_of_household key; HoH uses the single threshold
// (identical under current tax law).
const fsKey = (fs: string): "mfj" | "mfs" | "single" =>
  fs === "married_joint" ? "mfj" : fs === "married_separate" ? "mfs" : "single";

async function loadTaxContext(clientId: string, firmId: string) {
  const data = await loadClientData(clientId, firmId);
  const years = runProjection(data);
  const year = years[0];
  if (!year?.taxResult?.diag?.bracketsUsed) {
    throw new Error(
      "Tax brackets unavailable for this client — provide an override LTCG rate.",
    );
  }
  const fs = data.client.filingStatus;
  const params = year.taxResult.diag.bracketsUsed;
  return {
    ordinaryBase: year.taxResult.flow.incomeTaxBase,
    existingLtcg: year.taxResult.income.capitalGains,
    brackets: params.capGainsBrackets[fs],
    niit: {
      magi: year.taxResult.flow.adjustedGrossIncome,
      investmentIncome:
        year.taxResult.income.capitalGains + year.taxResult.income.dividends,
      threshold: params.niitThreshold[fsKey(fs)],
      rate: params.niitRate,
    },
  };
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

const TAXABLE_CATEGORY = "taxable";

export async function loadRebalanceInputs(
  clientId: string,
  firmId: string,
  body: RebalanceRequest,
): Promise<RebalanceInputs> {
  const [acRows, corrRows, settingsRow] = await Promise.all([
    db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
    // Correlations have no firmId column; they're implicitly firm-scoped because
    // assetClassIdA/B reference assetClasses (already filtered by firmId above) and
    // the assembler only consults rows whose asset classes are present.
    db.select({
      assetClassIdA: assetClassCorrelations.assetClassIdA,
      assetClassIdB: assetClassCorrelations.assetClassIdB,
      correlation: assetClassCorrelations.correlation,
    }).from(assetClassCorrelations),
    db.select().from(cmaSettings).where(eq(cmaSettings.firmId, firmId)),
  ]);

  const riskFreeRate = settingsRow[0] ? Number(settingsRow[0].riskFreeRate) : 0.04;

  const assetClasses: AssetClassFull[] = acRows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    geometricReturn: Number(c.geometricReturn),
    arithmeticMean: Number(c.arithmeticMean),
    volatility: Number(c.volatility),
    pctOrdinaryIncome: Number(c.pctOrdinaryIncome),
    pctLtCapitalGains: Number(c.pctLtCapitalGains),
    pctQualifiedDividends: Number(c.pctQualifiedDividends),
    pctTaxExempt: Number(c.pctTaxExempt),
  }));

  const slugToId = firmSlugToAssetClassId(acRows, firmId);

  // Account rows and enriched holdings are independent reads — fetch them together.
  const [acctRows, byAccount] = await Promise.all([
    db
      .select({ id: accountsTable.id, category: accountsTable.category })
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.clientId, clientId),
          inArray(accountsTable.id, body.accountIds),
        ),
      ),
    loadEnrichedHoldings(body.accountIds),
  ]);
  const taxableById = new Map(
    acctRows.map((a) => [a.id, a.category === TAXABLE_CATEGORY]),
  );

  const currentHoldings: CurrentHolding[] = [];
  for (const [accountId, rows] of byAccount) {
    const isTaxable = taxableById.get(accountId) ?? false;
    for (const h of rows) {
      const shares = Number(h.shares);
      const price = Number(h.price);
      currentHoldings.push({
        id: h.id,
        securityId: h.securityId,
        ticker: h.displayTicker ?? h.securityId ?? h.id,
        shares,
        price,
        marketValue: shares * price,
        costBasis: Number(h.costBasis),
        isTaxable,
        securityWeights: h.securityWeights,
        overrides: h.overrides,
      });
    }
  }

  const currentReturnsBySecurity = await loadReturns(
    [
      ...new Set(
        currentHoldings
          .map((h) => h.securityId)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
  );

  let targetHoldings: { securityId: string; ticker: string; weight: number }[] = [];
  let targetAllocations: AssetClassWeight[] = [];

  if ("portfolioId" in body.target) {
    const { portfolioId } = body.target;
    const holdings = await db
      .select()
      .from(tickerPortfolioHoldings)
      .where(eq(tickerPortfolioHoldings.tickerPortfolioId, portfolioId));
    targetHoldings = holdings
      .filter((h) => h.securityId)
      .map((h) => ({
        securityId: h.securityId!,
        ticker: h.displayTicker,
        weight: Number(h.weight),
      }));
    // loadTickerPortfolioAllocations returns every fund portfolio for the firm;
    // we keep only the requested one. (A targeted query is future-work — see plan.)
    const all = await loadTickerPortfolioAllocations(firmId, slugToId);
    targetAllocations = all
      .filter((a) => a.tickerPortfolioId === portfolioId)
      .map((a) => ({ assetClassId: a.assetClassId, weight: Number(a.weight) }));
  } else {
    const slugWeightAccum = new Map<string, number>();
    for (const { ticker, weight } of body.target.holdings) {
      const classified = await classifyTickerForRebalance(ticker);
      if (classified.securityId) {
        targetHoldings.push({
          securityId: classified.securityId,
          ticker,
          weight,
        });
      }
      for (const sw of classified.slugWeights) {
        const acId = slugToId.get(sw.slug);
        if (acId) {
          slugWeightAccum.set(
            acId,
            (slugWeightAccum.get(acId) ?? 0) + weight * sw.weight,
          );
        }
      }
    }
    targetAllocations = [...slugWeightAccum].map(([assetClassId, weight]) => ({
      assetClassId,
      weight,
    }));
  }

  const targetReturnsBySecurity = await loadReturns(
    targetHoldings.map((h) => h.securityId),
  );

  const taxContext =
    body.overrideLtcgRate != null
      ? {
          ordinaryBase: 0,
          existingLtcg: 0,
          brackets: { zeroPctTop: 0, fifteenPctTop: 0 },
          niit: { magi: 0, investmentIncome: 0, threshold: 0, rate: 0 },
        }
      : await loadTaxContext(clientId, firmId);

  return {
    riskFreeRate,
    assetClasses,
    correlationRows: corrRows.map((r) => ({
      assetClassIdA: r.assetClassIdA,
      assetClassIdB: r.assetClassIdB,
      correlation: Number(r.correlation),
    })),
    currentHoldings,
    currentReturnsBySecurity,
    targetHoldings,
    targetReturnsBySecurity,
    targetAllocations,
    taxContext,
    overrideLtcgRate: body.overrideLtcgRate,
  };
}

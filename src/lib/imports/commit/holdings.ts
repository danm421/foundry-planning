import { eq } from "drizzle-orm";

import { accountHoldings } from "@/db/schema";
import { classifySecurity as defaultClassify } from "@/lib/investments/classification/classify";
import {
  getSecurityByTicker as defaultGetByTicker,
  upsertClassifiedSecurity as defaultUpsert,
} from "@/lib/investments/classification/persist";
import { fetchEodCloses as defaultFetchCloses, eodhdSymbol } from "@/lib/investments/quote";
import { normalizeExtractedHolding } from "@/lib/extraction/normalize-holdings";
import type { ExtractedHolding } from "@/lib/extraction/types";
import type { ImportPayload } from "@/lib/imports/types";
import type { ResolvedHoldingsMap, Tx } from "./types";

export interface ResolveDeps {
  getSecurityByTicker?: typeof defaultGetByTicker;
  classifySecurity?: typeof defaultClassify;
  upsertClassifiedSecurity?: typeof defaultUpsert;
  fetchEodCloses?: typeof defaultFetchCloses;
}

/** Accounts that are actually committed (skip fuzzy — they are skipped at commit). */
function committableAccounts(payload: ImportPayload) {
  return payload.accounts.filter((a) => (a.match?.kind ?? "new") !== "fuzzy");
}

/**
 * PHASE A (runs in the commit route, BEFORE the transaction). Resolve every
 * tickered holding to a securityId + live price. Network-bound; never throws —
 * an unresolved ticker is simply omitted (commit falls back to a manual row).
 */
export async function resolveHoldingsForCommit(
  payload: ImportPayload,
  deps: ResolveDeps = {},
): Promise<ResolvedHoldingsMap> {
  const getByTicker = deps.getSecurityByTicker ?? defaultGetByTicker;
  const classify = deps.classifySecurity ?? defaultClassify;
  const upsert = deps.upsertClassifiedSecurity ?? defaultUpsert;
  const fetchCloses = deps.fetchEodCloses ?? defaultFetchCloses;

  const tickers = new Set<string>();
  for (const acct of committableAccounts(payload)) {
    for (const h of acct.holdings ?? []) {
      const t = h.ticker?.trim().toUpperCase();
      if (t) tickers.add(t);
    }
  }
  const map: ResolvedHoldingsMap = new Map();
  if (tickers.size === 0) return map;

  // Resolve security ids (cache, else classify+upsert).
  const securityIdByTicker = new Map<string, string>();
  for (const ticker of tickers) {
    try {
      const cached = await getByTicker(ticker);
      if (cached?.security?.id) {
        securityIdByTicker.set(ticker, cached.security.id);
        continue;
      }
      const classified = await classify(ticker);
      if (!classified) continue; // unresolved -> manual fallback
      const securityId = await upsert(classified);
      securityIdByTicker.set(ticker, securityId);
    } catch {
      // leave unresolved -> manual fallback
    }
  }

  // Bulk live prices. fetchEodCloses takes raw tickers; map is keyed by EODHD
  // symbol (e.g. VTI.US) — look up with eodhdSymbol(ticker).
  let priceMap = new Map<string, { price: number; asOf: string }>();
  try {
    priceMap = await fetchCloses([...securityIdByTicker.keys()]);
  } catch {
    // prices stay empty -> tickers keep null price (statement price used downstream)
  }

  for (const [ticker, securityId] of securityIdByTicker) {
    const quote = priceMap.get(eodhdSymbol(ticker));
    map.set(ticker, {
      securityId,
      price: quote?.price ?? null,
      asOf: quote?.asOf ?? null,
    });
  }
  return map;
}

/**
 * PHASE B (runs INSIDE the commit transaction, from commitAccounts). Write an
 * account's holdings. `replace` deletes existing holdings first (statement is
 * authoritative for a matched account). Records the account id on the sink for
 * the post-commit asset-mix sync.
 */
export async function writeAccountHoldings(
  tx: Tx,
  accountId: string,
  holdings: ExtractedHolding[],
  resolved: ResolvedHoldingsMap,
  replace: boolean,
  sink?: string[],
): Promise<void> {
  if (!holdings.length) return;
  if (replace) {
    await tx.delete(accountHoldings).where(eq(accountHoldings.accountId, accountId));
  }
  let sortOrder = 0;
  const rows = holdings.map((raw) => {
    const statementMv = raw.marketValue ?? null; // statement value, pre-normalization
    const h = normalizeExtractedHolding(raw);
    const ticker = h.ticker?.trim().toUpperCase();
    const r = ticker ? resolved.get(ticker) : undefined;
    const base = {
      accountId,
      displayTicker: h.ticker ?? null,
      displayName: h.name ?? null,
      shares: String(h.shares ?? 0),
      costBasis: String(h.costBasis ?? 0),
      sortOrder: sortOrder++,
      notes: null,
    };
    return r
      ? {
          // Classified ticker: live price (fallback to statement price), linked security.
          ...base,
          securityId: r.securityId,
          price: String(r.price ?? h.price ?? 0),
          priceAsOf: r.price != null ? r.asOf : null,
          marketValue: null, // tickered: live price drives shares×price
        }
      : {
          // Manual (bond / untickered fund / cash / unresolved ticker).
          ...base,
          securityId: null,
          price: String(h.price ?? 0),
          priceAsOf: null,
          // Untickered: statement value is authoritative (bonds: price is per $100 par).
          marketValue: statementMv != null ? String(statementMv) : null,
        };
  });
  await tx.insert(accountHoldings).values(rows);
  sink?.push(accountId);
}

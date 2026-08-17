/**
 * Backfill `security_price_history` for every security a portfolio actually
 * references — client account holdings and fund-portfolio holdings.
 *
 * Why this exists: only two code paths ever write price history, and neither
 * covers a client's account holdings. The fund-portfolio compute service
 * (`ticker-portfolio-compute.ts`) fetches history for tickers inside a saved
 * fund portfolio, and `classifyTickerForRebalance` (`rebalance/load-inputs.ts`)
 * fetches it for a proposal's TARGET tickers — but only on a cache MISS, so an
 * already-classified ticker is never retried. A holding sitting in a client
 * account is reached by neither. Without history a holding is silently dropped
 * from the realized backtest and the survivors are rescaled to 100%, so the
 * "current vs proposed" comparison quietly describes a portfolio nobody owns.
 *
 * Idempotent — re-runs skip any security already carrying the prior month's
 * bar, so this doubles as the monthly refresh until a cron covers it.
 *
 * Run:  DATABASE_URL='<direct, non-pooled url>' npx tsx scripts/backfill-security-price-history.ts
 *       ... --apply            actually write (default is a dry run)
 *       ... --only=VT,VXUS     restrict to these tickers
 *       ... --limit=25         stop after N securities (API budget)
 *
 * The DB host is printed — confirm the branch before passing --apply.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local without a runtime dep. Shell-sourcing breaks on `&` in the
// Neon URL, so scripts read it directly. An env var already set in the shell
// wins, which is how a prod run is targeted without editing .env.local. Must
// run before `@/db` is evaluated (it builds a Pool from process.env at module
// load) — hence the dynamic import inside main().
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local absent — rely on shell env.
}

/** History window start, matching FROM_DEFAULT in `lib/ticker-history.ts`. */
const FROM = "1996-01-01";

/** Courtesy pause between EODHD calls. */
const THROTTLE_MS = 120;

// The three write gates (too short / gappy / stale) and their reasoning live in
// `lib/investments/price-history-gates.ts`, shared with the monthly refresh
// cron so the two paths cannot drift into disagreeing about what is safe to
// store. Read that file before loosening anything here.

const hostOf = (url: string | undefined): string => {
  if (!url) return "(DATABASE_URL unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Skipped {
  ticker: string;
  reason: string;
  /** Rejected by the staleness gate — reported separately because, unlike the
   *  other skips, these securities may ALREADY carry rows from a run that
   *  predates the gate. Not writing does not un-write. */
  stale?: boolean;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const only = onlyArg
    ? new Set(onlyArg.slice("--only=".length).split(",").map((t) => t.trim().toUpperCase()))
    : null;
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;

  console.log(`DB host: ${hostOf(process.env.DATABASE_URL)}`);
  console.log(apply ? "mode: APPLY (writes)" : "mode: dry run (no writes)");

  if (!process.env.EODHD_API_KEY) {
    throw new Error("EODHD_API_KEY is not configured. Set it in .env.local.");
  }

  const { db } = await import("@/db");
  const { securityPriceHistory } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const { fetchMonthlyAdjustedClose } = await import("@/lib/cma-eodhd-history");
  const { eodhdSymbol } = await import("@/lib/investments/quote");
  const { assessPriceSeries, priorMonthKey } = await import(
    "@/lib/investments/price-history-gates"
  );

  // Every security referenced by either side of a proposal. Account holdings
  // are keyed by security_id; fund-portfolio rows usually store only
  // display_ticker (the builder's write path leaves security_id null), so they
  // resolve by ticker the same way `getSecurityByTicker` does — identifier_type
  // 'ticker' against the uppercased symbol.
  // neon-serverless `db.execute` returns a pg QueryResult — rows live on `.rows`.
  const result = await db.execute(sql`
    WITH referenced AS (
      SELECT ah.security_id AS security_id, NULL::text AS ticker
        FROM account_holdings ah
       WHERE ah.security_id IS NOT NULL
      UNION ALL
      SELECT tph.security_id, tph.display_ticker
        FROM ticker_portfolio_holdings tph
    ),
    resolved AS (
      SELECT COALESCE(r.security_id, s2.id) AS security_id
        FROM referenced r
        LEFT JOIN securities s2
          ON s2.identifier_type = 'ticker'
         AND s2.identifier = upper(r.ticker)
       WHERE COALESCE(r.security_id, s2.id) IS NOT NULL
    )
    SELECT DISTINCT
           s.id,
           s.identifier,
           s.identifier_type,
           s.security_type,
           (SELECT max(p.month) FROM security_price_history p WHERE p.security_id = s.id) AS last_bar
      FROM resolved rs
      JOIN securities s ON s.id = rs.security_id
     ORDER BY s.identifier
  `);

  const referenced = result.rows as unknown as {
    id: string;
    identifier: string;
    identifier_type: string;
    security_type: string | null;
    last_bar: string | null;
  }[];
  console.log(`${referenced.length} securities referenced by a holding or fund portfolio`);

  const prior = priorMonthKey(new Date());

  let fresh = 0;
  let written = 0;
  let barsWritten = 0;
  const skipped: Skipped[] = [];

  let processed = 0;
  for (const row of referenced) {
    if (processed >= limit) break;
    const ticker = row.identifier?.toUpperCase() ?? "";
    if (only && !only.has(ticker)) continue;

    // EODHD is addressed by symbol; a FIGI/CUSIP-identified row has nothing to
    // ask for. Report rather than guess at a mapping.
    if (row.identifier_type !== "ticker") {
      skipped.push({ ticker: `${row.identifier} (${row.identifier_type})`, reason: "not ticker-identified" });
      continue;
    }

    // Already carries the latest closed month — same freshness rule as
    // `isFresh` in lib/ticker-history.ts.
    if (row.last_bar && String(row.last_bar).slice(0, 7) >= prior) {
      fresh++;
      continue;
    }

    processed++;
    let bars: { date: string; adjClose: number }[];
    try {
      bars = await fetchMonthlyAdjustedClose(eodhdSymbol(ticker), { from: FROM });
    } catch (err) {
      skipped.push({ ticker, reason: `fetch failed: ${err instanceof Error ? err.message : "unknown"}` });
      await sleep(THROTTLE_MS);
      continue;
    }
    await sleep(THROTTLE_MS);

    const verdict = assessPriceSeries(bars, prior);
    if (!verdict.ok) {
      skipped.push({ ticker, reason: verdict.reason, stale: verdict.stale });
      continue;
    }

    const values = bars.map((b) => ({
      securityId: row.id,
      month: `${b.date.slice(0, 7)}-01`,
      adjustedClose: String(b.adjClose),
    }));

    // `onConflictDoNothing` makes an already-stored month a no-op, so counting
    // every fetched bar would report a re-run of a fully-covered security as
    // thousands of writes. History is append-only here (we always fetch from
    // FROM), so anything past the stored high-water mark is what actually lands.
    const lastStored = row.last_bar ? String(row.last_bar).slice(0, 7) : null;
    const newValues = lastStored ? values.filter((v) => v.month.slice(0, 7) > lastStored) : values;

    if (apply) {
      await db.insert(securityPriceHistory).values(values).onConflictDoNothing();
    }
    // Count a security only when it actually gains bars — an up-to-date series
    // that happens to miss the freshness cutoff writes nothing, and reporting
    // it as "written" is the same overstatement as counting no-op bars.
    if (newValues.length > 0) written++;
    barsWritten += newValues.length;
    console.log(
      `  ${apply ? "wrote" : "would write"} ${ticker.padEnd(8)} ${String(newValues.length).padStart(4)} new bars  ${verdict.firstMonth} → ${verdict.lastMonth}`,
    );
  }

  console.log("");
  console.log(`fresh (already current): ${fresh}`);
  console.log(`${apply ? "written" : "would write"}: ${written} securities, ${barsWritten} new bars`);

  const staleSkips = skipped.filter((s) => s.stale);
  const otherSkips = skipped.filter((s) => !s.stale);

  if (otherSkips.length > 0) {
    console.log(`\nskipped ${otherSkips.length} — these stay uncovered in the realized backtest:`);
    for (const s of otherSkips) console.log(`  ${s.ticker.padEnd(20)} ${s.reason}`);
    console.log(
      "\nA cash / money-market ticker is expected here: EODHD has no usable series for one.\nCovering it needs a risk-free proxy series, which is a product decision, not a fetch.",
    );
  }

  if (staleSkips.length > 0) {
    console.log(`\nstale ${staleSkips.length} — refused (see MAX_STALE_MONTHS):`);
    for (const s of staleSkips) console.log(`  ${s.ticker.padEnd(20)} ${s.reason}`);
    console.log(
      "\nThese re-fetch on every run: with nothing written, `last_bar` never reaches\n" +
        "the freshness bar. That is a handful of API calls a month, not a correctness\n" +
        "problem — the alternative is a table recording failed attempts.\n" +
        "⚠️  A security ALREADY carrying rows from a pre-gate run keeps them; this gate\n" +
        "only refuses new writes. Clearing those is a separate, deliberate delete.",
    );
  }

  if (!apply) console.log("\nDry run — pass --apply to write.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

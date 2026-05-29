// scripts/seed-securities.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local without a runtime dep (matches backfill-entity-cash-accounts.ts).
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch {
  /* .env.local absent — rely on shell env */
}

// A starter universe of common tickers. Grow over time; on-demand classification
// (Plan B) backfills anything an advisor enters that isn't here.
const SEED_TICKERS = [
  "VTI", "VOO", "SPY", "IVV", "VUG", "VTV", "VB", "VO", "VEA", "VWO", "VXUS",
  "IEFA", "IEMG", "BND", "AGG", "BNDX", "TIP", "VTIP", "HYG", "JNK", "MUB",
  "VGSH", "VGIT", "VGLT", "TLT", "SHY", "IEF", "VNQ", "GLD", "IAU", "DBC", "PDBC",
  "QQQ", "VYM", "SCHD", "AAPL", "MSFT", "BRK.B",
];

export async function seedSecurities(tickers: string[] = SEED_TICKERS): Promise<void> {
  const { classifySecurity } = await import("../src/lib/investments/classification/classify");
  const { upsertClassifiedSecurity } = await import("../src/lib/investments/classification/persist");

  let ok = 0, skipped = 0;
  for (const ticker of tickers) {
    const classified = await classifySecurity(ticker);
    if (!classified) {
      skipped++;
      console.warn(`  skip  ${ticker} (no classification)`);
      continue;
    }
    await upsertClassifiedSecurity(classified);
    ok++;
    const top = classified.weights[0];
    console.log(`  ok    ${ticker} → ${top?.slug} ${((top?.weight ?? 0) * 100).toFixed(0)}%${classified.weights.length > 1 ? " …" : ""}`);
  }
  console.log(`\nDone: ${ok} classified, ${skipped} skipped.`);
}

const argvUrl = process.argv[1] ? `file://${process.argv[1]}` : "";
if (import.meta.url === argvUrl) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run from the repo root with .env.local present.");
    process.exit(1);
  }
  if (!process.env.EODHD_API_KEY) {
    console.error("EODHD_API_KEY is not set. Add it to .env.local.");
    process.exit(1);
  }
  seedSecurities()
    .then(() => process.exit(0))
    .catch((err) => { console.error("Seed failed:", err); process.exit(1); });
}

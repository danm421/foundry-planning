/**
 * Backfill life_insurance_policies rows for every existing accounts row
 * with category = 'life_insurance'. Uses conservative defaults:
 * face_value = accounts.value, policy_type derived from accounts.sub_type,
 * insured_person derived from accounts.owner.
 * Advisors update the real values through the new Insurance panel.
 *
 * Run with: npx tsx scripts/backfill-life-insurance.ts
 * Idempotent — re-runs skip accounts that already have a policy row.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local without a runtime dep. Shell-sourcing breaks on `&` in the
// Neon URL, so scripts read it directly. Must run before `../src/db` is
// evaluated (which constructs a Pool from process.env.DATABASE_URL at module
// load) — so the db import is dynamic, inside main().
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
} catch {}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run from the repo root with .env.local present.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/db");
  const { accounts, lifeInsurancePolicies } = await import("../src/db/schema");
  const { eq, and, isNull } = await import("drizzle-orm");

  const existing = await db
    .select()
    .from(accounts)
    .leftJoin(
      lifeInsurancePolicies,
      eq(accounts.id, lifeInsurancePolicies.accountId),
    )
    .where(
      and(
        eq(accounts.category, "life_insurance"),
        isNull(lifeInsurancePolicies.accountId),
      ),
    );

  console.log(`Found ${existing.length} life_insurance accounts needing backfill.`);

  for (const row of existing) {
    const a = row.accounts;
    const policyType = mapSubTypeToPolicyType(a.subType);
    const insured = "client"; // owner column dropped in migration 0060; default to client for historical backfill

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ insuredPerson: insured })
        .where(eq(accounts.id, a.id));

      await tx.insert(lifeInsurancePolicies).values({
        accountId: a.id,
        // Term policies often store cash value (often $0) here, not face — advisor must edit.
        faceValue: a.value,
        costBasis: "0",
        premiumAmount: "0",
        premiumYears: null,
        policyType,
        termIssueYear: null,
        termLengthYears: null,
        endsAtInsuredRetirement: false,
        cashValueGrowthMode: "basic",
        postPayoutGrowthRate: "0.06",
      });
    });

    console.log(`Backfilled ${a.name} (${a.id})`);
  }

  console.log(`Backfill complete. ${existing.length} accounts processed.`);
}

function mapSubTypeToPolicyType(
  subType: string | null,
): "term" | "whole" | "universal" | "variable" {
  switch (subType) {
    case "term":
      return "term";
    case "whole_life":
      return "whole";
    case "universal_life":
      return "universal";
    case "variable_life":
      return "variable";
    default:
      return "whole";
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

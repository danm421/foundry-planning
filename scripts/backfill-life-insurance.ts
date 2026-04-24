/**
 * Backfill life_insurance_policies rows for every existing accounts row
 * with category = 'life_insurance'. Uses conservative defaults:
 * face_value = accounts.value, policy_type derived from accounts.sub_type,
 * insured_person derived from accounts.owner.
 * Advisors update the real values through the new Insurance panel.
 *
 * Run with: DATABASE_URL="<...>" npx tsx scripts/backfill-life-insurance.ts
 * Or copy DATABASE_URL from .env.local and pass it as an environment variable.
 */

import { db } from "../src/db";
import { accounts, lifeInsurancePolicies } from "../src/db/schema";
import { eq, and, isNull } from "drizzle-orm";

async function main() {
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
    const insured = a.owner === "joint" ? "joint" : a.owner; // client | spouse | joint

    await db.transaction(async (tx) => {
      // Populate insured_person on the account.
      await tx
        .update(accounts)
        .set({ insuredPerson: insured })
        .where(eq(accounts.id, a.id));

      // Insert the policy child row with conservative defaults.
      await tx.insert(lifeInsurancePolicies).values({
        accountId: a.id,
        faceValue: a.value, // treat existing `value` as death benefit
        costBasis: "0",
        premiumAmount: "0",
        premiumYears: null,
        policyType,
        termIssueYear: null,
        termLengthYears: null,
        endsAtInsuredRetirement: false,
        cashValueGrowthMode: "basic",
        postPayoutMergeAccountId: null,
        postPayoutGrowthRate: "0.06",
      });
    });

    console.log(`Backfilled ${a.name} (${a.id})`);
  }
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
      return "whole"; // conservative default for null or unmapped values
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

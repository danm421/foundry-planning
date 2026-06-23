// src/lib/portal/__tests__/load-portal-investments.test.ts
//
// DB-backed: hits the dev Neon branch. Run with `--testTimeout=30000` to
// survive Neon cold-start.
//
// Seeds the full FK chain so the rollup produces a NAMED allocation and
// totalValue ≈ 1000:
//   firm → household → client → base-case scenario   (createTestClientWithScenario)
//   → retirement account (portal-visible)
//   → asset class (us_large_cap)
//   → security (VTI) → securityAssetClassWeights (VTI → us_large_cap @ 1.0)
//   → accountHoldings (VTI, shares=4 × price=250 = $1000, marketValue=null)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  accounts,
  accountHoldings,
  assetClasses,
  clients,
  crmHouseholds,
  securities,
  securityAssetClassWeights,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { loadPortalInvestments } from "../load-portal-investments";

const firmIds: string[] = [];
let securityId = "";

async function seedClientWithInvestmentAccount(): Promise<{ clientId: string }> {
  const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
  firmIds.push(firmId);
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);

  await db.insert(assetClasses).values({
    firmId,
    name: "US Large Cap",
    slug: "us_large_cap",
  });

  const [account] = await db
    .insert(accounts)
    .values({
      clientId,
      scenarioId,
      name: "Rollover IRA",
      category: "retirement",
      isDefaultChecking: false,
      parentAccountId: null,
    })
    .returning();

  // shares×price = 4 × 250 = 1000; marketValue=null → derive shares×price.
  await db.insert(accountHoldings).values({
    accountId: account.id,
    securityId,
    displayTicker: "VTI",
    displayName: "Vanguard Total Stock Market ETF",
    shares: "4",
    price: "250",
    costBasis: "800",
    marketValue: null,
  });

  return { clientId };
}

beforeAll(async () => {
  const [sec] = await db
    .insert(securities)
    .values({
      identifierType: "ticker",
      identifier: `VTI_${randomBytes(4).toString("hex")}`,
      name: "Vanguard Total Stock Market ETF",
      securityType: "etf",
    })
    .returning();
  securityId = sec.id;

  await db.insert(securityAssetClassWeights).values({
    securityId,
    assetClassSlug: "us_large_cap",
    weight: "1",
  });
});

afterAll(async () => {
  // Deleting the client cascades accounts → accountHoldings; deleting the
  // security cascades securityAssetClassWeights. assetClasses are firm-scoped
  // (no FK from clients), so delete them by firmId explicitly.
  for (const firmId of firmIds) {
    const clientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.firmId, firmId));
    for (const c of clientRows) {
      await db.delete(clients).where(eq(clients.id, c.id));
    }
    await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
  }
  if (securityId) await db.delete(securities).where(eq(securities.id, securityId));
});

describe("loadPortalInvestments", () => {
  it("returns investment accounts with value, holdings, and asset-class allocations", async () => {
    const { clientId } = await seedClientWithInvestmentAccount();
    const data = await loadPortalInvestments(clientId);

    expect(data.totalValue).toBeCloseTo(1000);
    expect(data.accounts).toHaveLength(1);

    const acct = data.accounts[0];
    expect(acct.category).toBe("retirement");
    expect(acct.value).toBeCloseTo(1000);
    expect(acct.holdings).toHaveLength(1);
    expect(acct.holdings[0].ticker).toBe("VTI");
    expect(acct.holdings[0].marketValue).toBeCloseTo(1000);
    expect(acct.holdings[0].costBasis).toBeCloseTo(800);
    expect(acct.allocations[0].name).toMatch(/Large/i);
    expect(acct.allocations[0].weight).toBeCloseTo(1, 1);

    expect(data.overallAllocations[0].name).toMatch(/Large/i);
    expect(data.overallAllocations[0].weight).toBeCloseTo(1, 1);
  });
});

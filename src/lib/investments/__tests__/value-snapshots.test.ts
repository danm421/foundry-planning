// src/lib/investments/__tests__/value-snapshots.test.ts
//
// DB-backed: hits the dev Neon branch (account_value_snapshots + account_holdings
// already live). Run with --testTimeout=30000 to survive Neon cold-start.
import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountHoldings,
  accountValueSnapshots,
  clients,
  crmHouseholds,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { snapshotInvestmentValues, loadInvestmentSeries } from "../value-snapshots";

// Track every firmId we insert so afterAll cleans up deterministically.
const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `test_firm_${randomBytes(4).toString("hex")}`;
  firmIds.push(id);
  return id;
}

/** Seed firm → client → base scenario → account, then insert the given holdings.
 *  Returns the accountId. */
async function seedAccountWithHoldings(
  holdings: Array<{ shares: string; price: string; marketValue: string | null }>,
): Promise<string> {
  const firmId = freshFirmId();
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);

  const [account] = await db
    .insert(accounts)
    .values({
      clientId,
      scenarioId,
      name: "Brokerage",
      category: "taxable",
    })
    .returning();

  for (const h of holdings) {
    await db.insert(accountHoldings).values({
      accountId: account.id,
      shares: h.shares,
      price: h.price,
      ...(h.marketValue != null ? { marketValue: h.marketValue } : {}),
    });
  }

  return account.id;
}

afterAll(async () => {
  // Deleting the client cascades accounts → accountHoldings → accountValueSnapshots.
  for (const firmId of firmIds) {
    const clientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.firmId, firmId));
    for (const c of clientRows) {
      await db.delete(clients).where(eq(clients.id, c.id));
    }
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
  }
});

describe("snapshotInvestmentValues", () => {
  it("upserts Σ holdingMarketValue per account for the given day", async () => {
    const accountId = await seedAccountWithHoldings([
      { shares: "10", price: "100", marketValue: null }, // 1000 derived (tickered: shares×price)
      { shares: "0", price: "0", marketValue: "250.00" }, // 250 authoritative (untickered)
    ]);

    const n = await snapshotInvestmentValues([accountId], "2026-06-23");
    expect(n).toBe(1);

    const [snap] = await db
      .select()
      .from(accountValueSnapshots)
      .where(eq(accountValueSnapshots.accountId, accountId));
    expect(snap.asOfDate).toBe("2026-06-23");
    expect(Number(snap.value)).toBeCloseTo(1250);

    // Re-run same day updates in place (no duplicate row).
    await db
      .update(accountHoldings)
      .set({ price: "110" })
      .where(eq(accountHoldings.accountId, accountId));
    await snapshotInvestmentValues([accountId], "2026-06-23");

    const rows = await db
      .select()
      .from(accountValueSnapshots)
      .where(eq(accountValueSnapshots.accountId, accountId));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].value)).toBeCloseTo(1350); // 10*110 + 250
  });

  it("returns 0 for empty accountIds", async () => {
    const n = await snapshotInvestmentValues([], "2026-06-23");
    expect(n).toBe(0);
  });
});

describe("loadInvestmentSeries", () => {
  it("returns per-account series and a summed total", async () => {
    const a = await seedAccountWithHoldings([{ shares: "1", price: "100", marketValue: null }]);
    const b = await seedAccountWithHoldings([{ shares: "1", price: "200", marketValue: null }]);
    await snapshotInvestmentValues([a, b], "2026-06-22");
    await snapshotInvestmentValues([a, b], "2026-06-23");
    const { perAccount, total } = await loadInvestmentSeries([a, b]);
    expect(perAccount.get(a)!.map((p) => p.netWorth)).toEqual([100, 100]);
    expect(total.map((p) => [p.date, p.netWorth])).toEqual([["2026-06-22", 300], ["2026-06-23", 300]]);
  });
});

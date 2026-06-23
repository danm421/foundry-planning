// src/lib/plaid/__tests__/ingest-holdings.test.ts
//
// DB-backed: hits the dev Neon branch (the schema migration adding
// account_holdings.source / .plaid_security_id + the new enum value is already
// applied there). Run with `--testTimeout=30000` to survive Neon cold-start.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

// `securityId` is a uuid FK to securities.id — a literal "sec-VTI" would fail the
// INSERT. We seed a real VTI security row (see beforeAll) and have the mock hand
// back its real uuid; the assertion checks the resolved id flows through.
let vtiSecurityId = "";
vi.mock("@/lib/investments/ensure-security", () => ({
  ensureSecurityForTicker: vi.fn(async (t: string | null) => (t ? vtiSecurityId : null)),
}));
// Hoisted so the (hoisted) vi.mock factory below can reference it without a TDZ.
const { syncAccountFromHoldings } = vi.hoisted(() => ({
  syncAccountFromHoldings: vi.fn(async () => {}),
}));
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({ syncAccountFromHoldings }));

import { db } from "@/db";
import {
  accounts,
  accountHoldings,
  clients,
  crmHouseholds,
  securities,
  plaidItems,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { ingestHoldingsForItem } from "../ingest-holdings";

// Track every firmId / securityId we touch so afterAll cleans up deterministically.
const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `test_firm_${randomBytes(4).toString("hex")}`;
  firmIds.push(id);
  return id;
}

/**
 * Seed firm → client → scenario → account, with the account linked to a Plaid
 * item. `accounts.plaidItemId` is an FK to plaid_items.id (ON DELETE SET NULL),
 * so a plaid_items row must exist first; we use its id as itemRowId.
 */
async function seedPlaidAccount(): Promise<{ itemRowId: string; accountId: string }> {
  const firmId = freshFirmId();
  const { clientId, scenarioId } = await createTestClientWithScenario(firmId);

  const [item] = await db
    .insert(plaidItems)
    .values({
      clientId,
      plaidItemId: `plaid_item_${randomBytes(4).toString("hex")}`,
      accessToken: "enc:fake",
      institutionName: "Test Bank",
    })
    .returning();

  const [account] = await db
    .insert(accounts)
    .values({
      clientId,
      scenarioId,
      name: "Brokerage",
      category: "taxable",
      plaidItemId: item.id,
      plaidAccountId: "p-acc",
    })
    .returning();

  return { itemRowId: item.id, accountId: account.id };
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
  vtiSecurityId = sec.id;
});

afterAll(async () => {
  // Deleting the client cascades accounts → accountHoldings and plaidItems.
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
  if (vtiSecurityId) await db.delete(securities).where(eq(securities.id, vtiSecurityId));
});

describe("ingestHoldingsForItem", () => {
  it("replaces plaid holdings, keeps manual holdings, sets value/basis/source, syncs", async () => {
    const { itemRowId, accountId } = await seedPlaidAccount();
    syncAccountFromHoldings.mockClear();

    // pre-existing manual holding (must survive)
    await db.insert(accountHoldings).values({
      accountId,
      source: "manual",
      displayTicker: "MANUAL",
      shares: "1",
      price: "1",
      costBasis: "1",
      marketValue: "1",
    });
    // pre-existing stale plaid holding (should be deleted + replaced)
    await db.insert(accountHoldings).values({
      accountId,
      source: "plaid",
      displayTicker: "OLD",
      shares: "1",
      price: "1",
      costBasis: "1",
    });

    const res = await ingestHoldingsForItem(itemRowId, [
      {
        plaidAccountId: "p-acc",
        plaidSecurityId: "s1",
        ticker: "VTI",
        name: "Vanguard",
        shares: "10",
        price: "100",
        priceAsOf: "2026-06-20",
        institutionValue: 1000,
        costBasis: "800",
      },
      {
        plaidAccountId: "p-acc",
        plaidSecurityId: "s2",
        ticker: null,
        name: "Private Fund",
        shares: "1",
        price: "0",
        priceAsOf: null,
        institutionValue: 500,
        costBasis: "500",
      },
    ]);

    expect(res).toEqual({ accountsUpdated: 1, holdingsWritten: 2 });

    const rows = await db
      .select()
      .from(accountHoldings)
      .where(eq(accountHoldings.accountId, accountId));
    const bySource = rows.reduce(
      (m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m),
      {} as Record<string, number>,
    );
    expect(bySource).toEqual({ manual: 1, plaid: 2 });

    const vti = rows.find((r) => r.displayTicker === "VTI")!;
    expect(vti.marketValue).toBeNull(); // tickered → derive shares×price
    expect(vti.securityId).toBe(vtiSecurityId);

    const priv = rows.find((r) => r.displayTicker === null && r.displayName === "Private Fund")!;
    expect(priv.marketValue).toBe("500.00"); // untickered → authoritative
    expect(priv.securityId).toBeNull();

    const [acct] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(acct.source).toBe("plaid");
    expect(Number(acct.value)).toBeCloseTo(1500); // 10*100 + 500
    expect(Number(acct.basis)).toBeCloseTo(1300); // 800 + 500

    expect(syncAccountFromHoldings).toHaveBeenCalledWith(accountId);
  });
});

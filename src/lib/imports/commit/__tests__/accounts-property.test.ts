import { describe, expect, it } from "vitest";

import { accounts } from "@/db/schema";

import { commitAccounts } from "../accounts";
import { emptyImportPayload, type ImportPayload } from "../../types";
import type { CommitContext } from "../types";

const CTX: CommitContext = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

/**
 * Minimal tx double, mirroring commit/__tests__/savings.test.ts's `fakeTx`:
 * records inserts, and answers the family-members lookup `commitAccounts`
 * makes via `loadFamilyRoleIds` with an empty household (no owner row is
 * written either way — this test only cares about the inserted account row).
 */
function fakeTx() {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let nextId = 0;
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        nextId += 1;
        const rows = [{ id: `account-${nextId}` }];
        return Object.assign(Promise.resolve(), { returning: async () => rows });
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => { updated.push(v); },
      }),
    }),
    select: () => ({
      from: () => ({ where: async () => [] }),
    }),
  };
  return { tx: tx as never, inserted, updated };
}

function payloadWith(accounts: ImportPayload["accounts"]): ImportPayload {
  return { ...emptyImportPayload(), accounts };
}

describe("accounts schema", () => {
  it("has a property_address column for a real-estate account", () => {
    expect(accounts.propertyAddress).toBeDefined();
    expect(accounts.propertyAddress.name).toBe("property_address");
  });
});

describe("commitAccounts", () => {
  it("writes propertyAddress and annualPropertyTax on a new real-estate account", async () => {
    const { tx, inserted } = fakeTx();
    await commitAccounts(
      tx,
      payloadWith([
        {
          name: "5304 Hudson Avenue",
          category: "real_estate",
          subType: "primary_residence",
          propertyAddress: "5304 Hudson Avenue",
          annualPropertyTax: 7_500,
          __rowId: "account:hudson#f1:0",
          match: { kind: "new" },
        },
      ]),
      CTX,
    );
    expect(inserted[0].propertyAddress).toBe("5304 Hudson Avenue");
    expect(inserted[0].annualPropertyTax).toBe("7500");
  });
});

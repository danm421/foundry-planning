// purgeCrmHouseholdById must erase the household's intake forms: both
// intake_forms foreign keys are ON DELETE SET NULL, so without an explicit
// delete the answers, recipient details and public link outlive the household.
// Mocked at the db seam (no database); the where clauses are rendered to SQL.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({
  household: null as unknown,
  deletes: [] as Array<{ table: unknown; where: unknown }>,
}));

vi.mock("@/db", () => {
  const tx = {
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        state.deletes.push({ table, where });
      },
    }),
  };
  return {
    db: {
      query: { crmHouseholds: { findFirst: async () => state.household } },
      select: () => ({ from: () => ({ where: async () => [] }) }),
      transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    },
  };
});
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordDelete: vi.fn() }));
vi.mock("@/lib/audit/snapshots/household", () => ({ toHouseholdSnapshot: () => ({}) }));
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ itemRemove: vi.fn() }) }));

import { purgeCrmHouseholdById } from "../households";

const FIRM = "firm_a";
const HH = "hh-1";
const CLIENT = "client-1";

function sqlOf(where: unknown) {
  return new PgDialect().sqlToQuery(where as SQL);
}
const order = () => state.deletes.map((d) => getTableName(d.table as never));

beforeEach(() => {
  state.deletes = [];
});

describe("purgeCrmHouseholdById — intake forms", () => {
  it("deletes forms for the household and its planning client, within the firm, before the client and household rows", async () => {
    state.household = { id: HH, firmId: FIRM, deletedAt: new Date(), planningClient: { id: CLIENT } };

    await purgeCrmHouseholdById(HH, FIRM);

    expect(order()).toEqual(["intake_forms", "clients", "crm_households"]);
    const q = sqlOf(state.deletes[0].where);
    expect(q.sql).toContain('"intake_forms"."firm_id"');
    expect(q.sql).toContain('"intake_forms"."client_id"');
    expect(q.sql).toContain('"intake_forms"."crm_household_id"');
    expect(q.params).toEqual(expect.arrayContaining([FIRM, CLIENT, HH]));
  });

  it("deletes forms parked on a household that has no planning client", async () => {
    state.household = { id: HH, firmId: FIRM, deletedAt: new Date(), planningClient: null };

    await purgeCrmHouseholdById(HH, FIRM);

    expect(order()).toEqual(["intake_forms", "crm_households"]);
    const q = sqlOf(state.deletes[0].where);
    expect(q.sql).toContain('"intake_forms"."crm_household_id"');
    expect(q.params).toEqual(expect.arrayContaining([FIRM, HH]));
  });
});

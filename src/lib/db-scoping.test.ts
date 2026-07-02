import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Direct unit tests for the cross-tenant FK-assert helpers in
 * `db-scoping.ts` — the primary defense against cross-firm FK injection
 * (F1 / F10). The audit (F9) flagged that these were only exercised
 * incidentally, so a silent regression in the `clientId` / `firmId`
 * filter would pass CI.
 *
 * To make that filter testable we run the real helpers against a tiny
 * in-memory "database": we override drizzle's `eq` / `inArray` / `and`
 * with inspectable predicate builders and stub `@/db` with a query
 * builder that *evaluates* those predicates over in-memory rows. So if
 * someone drops `eq(accounts.clientId, clientId)` from a helper, the
 * cross-tenant row is no longer filtered out and the corresponding
 * "rejects another client's id" test fails — exactly the regression we
 * want CI to catch.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Col = { name: string };
  type Pred =
    | { k: "eq"; name: string; val: unknown }
    | { k: "in"; name: string; vals: unknown[] }
    | { k: "and"; conds: Pred[] };
  const tables: Record<string, Row[]> = {};
  function evalPred(pred: Pred, row: Row): boolean {
    if (pred.k === "eq") return row[pred.name] === pred.val;
    if (pred.k === "in") return pred.vals.includes(row[pred.name]);
    return pred.conds.every((c) => evalPred(c, row));
  }
  return {
    tables,
    evalPred,
    eq: (col: Col, val: unknown): Pred => ({ k: "eq", name: col.name, val }),
    inArray: (col: Col, vals: unknown[]): Pred => ({ k: "in", name: col.name, vals }),
    and: (...conds: Pred[]): Pred => ({ k: "and", conds }),
  };
});

// Keep the real drizzle-orm (schema.ts needs pgTable/uuid/sql at load) but
// swap the three query predicates for inspectable + evaluable versions.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: h.eq, inArray: h.inArray, and: h.and };
});

// Evaluable stub DB: select(proj).from(table).where(pred) → filtered, projected rows.
vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Proj = Record<string, { name: string }>;
  const db = {
    select(proj: Proj) {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const tableName = getTableName(table);
          return {
            where(pred: Parameters<typeof h.evalPred>[0]) {
              const rows = (h.tables[tableName] ?? []).filter((r) => h.evalPred(pred, r));
              return Promise.resolve(
                rows.map((r) => {
                  const out: Record<string, unknown> = {};
                  for (const key of Object.keys(proj)) out[key] = r[proj[key].name];
                  return out;
                }),
              );
            },
          };
        },
      };
    },
  };
  return { db };
});

import { getTableName } from "drizzle-orm";
import {
  accounts,
  liabilities,
  entities,
  externalBeneficiaries,
  familyMembers,
  modelPortfolios,
  assetClasses,
  clients,
  tickerPortfolios,
} from "@/db/schema";
import {
  assertAccountsInClient,
  assertBusinessAccountsInClient,
  assertLiabilitiesInClient,
  assertEntitiesInClient,
  assertFamilyMembersInClient,
  assertExternalBeneficiariesInClient,
  assertModelPortfoliosInFirm,
  assertTickerPortfoliosInFirm,
  assertAssetClassesInFirm,
  findClientInFirm,
} from "@/lib/db-scoping";

function setTable(table: Parameters<typeof getTableName>[0], rows: Record<string, unknown>[]) {
  h.tables[getTableName(table)] = rows;
}

beforeEach(() => {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
});

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("assertAccountsInClient", () => {
  it("is ok (no query) when ids are empty / null / undefined", async () => {
    expect((await assertAccountsInClient("cA", [])).ok).toBe(true);
    expect((await assertAccountsInClient("cA", [null, undefined, ""])).ok).toBe(true);
  });

  it("is ok when every account belongs to the client", async () => {
    setTable(accounts, [{ id: A, client_id: "cA" }]);
    expect((await assertAccountsInClient("cA", [A])).ok).toBe(true);
  });

  it("rejects an id that belongs to ANOTHER client (clientId filter guard)", async () => {
    // Row exists by id but is owned by cB — the clientId filter must exclude it.
    setTable(accounts, [{ id: A, client_id: "cB" }]);
    const res = await assertAccountsInClient("cA", [A]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(A);
  });

  it("rejects an id that does not exist at all", async () => {
    setTable(accounts, []);
    expect((await assertAccountsInClient("cA", [A])).ok).toBe(false);
  });

  it("rejects when only some ids are in-client", async () => {
    setTable(accounts, [{ id: A, client_id: "cA" }]);
    const res = await assertAccountsInClient("cA", [A, B]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(B);
  });
});

describe("assertBusinessAccountsInClient", () => {
  it("is ok for in-client business accounts", async () => {
    setTable(accounts, [{ id: A, client_id: "cA", category: "business" }]);
    expect((await assertBusinessAccountsInClient("cA", [A])).ok).toBe(true);
  });

  it("rejects an in-client account whose category is not business", async () => {
    setTable(accounts, [{ id: A, client_id: "cA", category: "cash" }]);
    const res = await assertBusinessAccountsInClient("cA", [A]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("business");
  });

  it("rejects a business account owned by another client (clientId filter guard)", async () => {
    setTable(accounts, [{ id: A, client_id: "cB", category: "business" }]);
    expect((await assertBusinessAccountsInClient("cA", [A])).ok).toBe(false);
  });
});

describe("assertLiabilitiesInClient", () => {
  it("is ok when the liability belongs to the client", async () => {
    setTable(liabilities, [{ id: A, client_id: "cA" }]);
    expect((await assertLiabilitiesInClient("cA", [A])).ok).toBe(true);
  });

  it("rejects a liability owned by another client (clientId filter guard)", async () => {
    setTable(liabilities, [{ id: A, client_id: "cB" }]);
    const res = await assertLiabilitiesInClient("cA", [A]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(A);
  });
});

describe("assertEntitiesInClient", () => {
  it("is ok when the entity belongs to the client", async () => {
    setTable(entities, [{ id: A, client_id: "cA" }]);
    expect((await assertEntitiesInClient("cA", [A])).ok).toBe(true);
  });

  it("rejects an entity owned by another client (clientId filter guard)", async () => {
    setTable(entities, [{ id: A, client_id: "cB" }]);
    expect((await assertEntitiesInClient("cA", [A])).ok).toBe(false);
  });
});

describe("assertFamilyMembersInClient", () => {
  it("is ok (no query) when ids are empty / null / undefined", async () => {
    expect((await assertFamilyMembersInClient("cA", [])).ok).toBe(true);
    expect((await assertFamilyMembersInClient("cA", [null, undefined, ""])).ok).toBe(true);
  });

  it("is ok when the family member belongs to the client", async () => {
    setTable(familyMembers, [{ id: A, client_id: "cA" }]);
    expect((await assertFamilyMembersInClient("cA", [A])).ok).toBe(true);
  });

  it("rejects a family member owned by another client (clientId filter guard)", async () => {
    setTable(familyMembers, [{ id: A, client_id: "cB" }]);
    const res = await assertFamilyMembersInClient("cA", [A]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(A);
  });
});

describe("assertExternalBeneficiariesInClient", () => {
  it("is ok when the external beneficiary belongs to the client", async () => {
    setTable(externalBeneficiaries, [{ id: A, client_id: "cA" }]);
    expect((await assertExternalBeneficiariesInClient("cA", [A])).ok).toBe(true);
  });

  it("rejects an external beneficiary owned by another client (clientId filter guard)", async () => {
    setTable(externalBeneficiaries, [{ id: A, client_id: "cB" }]);
    const res = await assertExternalBeneficiariesInClient("cA", [A]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(A);
  });
});

describe("assertModelPortfoliosInFirm", () => {
  it("is ok when the portfolio belongs to the firm", async () => {
    setTable(modelPortfolios, [{ id: A, firm_id: "fA" }]);
    expect((await assertModelPortfoliosInFirm("fA", [A])).ok).toBe(true);
  });

  it("rejects a portfolio owned by another firm (firmId filter guard)", async () => {
    setTable(modelPortfolios, [{ id: A, firm_id: "fB" }]);
    expect((await assertModelPortfoliosInFirm("fA", [A])).ok).toBe(false);
  });
});

describe("assertTickerPortfoliosInFirm", () => {
  it("accepts an in-firm fund portfolio id", async () => {
    setTable(tickerPortfolios, [{ id: A, firm_id: "fA" }]);
    expect((await assertTickerPortfoliosInFirm("fA", [A])).ok).toBe(true);
  });
  it("rejects a fund portfolio owned by another firm (firmId filter guard)", async () => {
    setTable(tickerPortfolios, [{ id: A, firm_id: "fB" }]);
    expect((await assertTickerPortfoliosInFirm("fA", [A])).ok).toBe(false);
  });
});

describe("assertAssetClassesInFirm", () => {
  it("is ok when every asset class belongs to the firm", async () => {
    setTable(assetClasses, [
      { id: A, firm_id: "fA" },
      { id: B, firm_id: "fA" },
    ]);
    expect((await assertAssetClassesInFirm("fA", [A, B])).ok).toBe(true);
  });

  it("rejects an asset class owned by another firm (firmId filter guard — F10)", async () => {
    setTable(assetClasses, [
      { id: A, firm_id: "fA" },
      { id: B, firm_id: "fB" },
    ]);
    const res = await assertAssetClassesInFirm("fA", [A, B]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain(B);
  });
});

describe("findClientInFirm", () => {
  it("returns the row when the client is in the firm", async () => {
    setTable(clients, [{ id: "cA", firm_id: "fA" }]);
    expect(await findClientInFirm("cA", "fA")).toEqual({ id: "cA" });
  });

  it("returns null when the client belongs to another firm", async () => {
    setTable(clients, [{ id: "cA", firm_id: "fB" }]);
    expect(await findClientInFirm("cA", "fA")).toBeNull();
  });
});

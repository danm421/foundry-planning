import { describe, it, expect, vi } from "vitest";

const rows = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  liabilities: [] as Record<string, unknown>[],
}));

vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts" },
  liabilities: { _name: "liabilities" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  isNull: (...a: unknown[]) => a,
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: "accounts" | "liabilities" }) => ({
        where: () => ({ orderBy: () => Promise.resolve(rows[tbl._name]) }),
      }),
    }),
  },
}));

import { loadLinkCandidates } from "../portal-link-helpers";

const acct = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  category: "cash",
  subType: "savings",
  isDefaultChecking: false,
  parentAccountId: null,
  ...over,
});

describe("loadLinkCandidates", () => {
  it("offers only accounts the portal shows the client", async () => {
    rows.accounts = [
      acct("visible"),
      acct("business", { category: "business" }),
      acct("household-cash", { isDefaultChecking: true }),
      acct("sub-account", { parentAccountId: "p1" }),
    ];
    const { existingCandidates } = await loadLinkCandidates("c1");
    expect(existingCandidates).toEqual([
      { id: "visible", name: "visible", category: "cash", subType: "savings" },
    ]);
  });
});

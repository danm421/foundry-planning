// The two strings this document calls a household by, and the cheap reader the
// samples route uses to learn them without paying for a projection.
//
// `composeStoryHousehold` is the shared spelling: `loadStoryContext` composes
// the pair with it off the effective tree, and `loadStoryHousehold` composes it
// off the CRM contacts. `load-context.test.ts` asserts the strings that come out
// of the loader, so mutating the composer goes red THERE as well — which is what
// makes "one spelling" a pin rather than a claim.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  clientRows: [] as Array<{ crmHouseholdId: string }>,
  contactRows: [] as Array<{ role: string; firstName: string; lastName: string }>,
  /** Column names each WHERE was built from, oldest first. */
  wheres: [] as string[][],
}));

/** Column names inside a drizzle condition, so a dropped scope shows up as a
 *  missing name rather than as a query that happens to still return rows. */
function columnsIn(condition: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.name === "string" && o.table) names.push(o.name);
    for (const v of Object.values(o)) if (Array.isArray(v)) v.forEach(walk);
  };
  walk(condition);
  return names;
}

vi.mock("@/db", () => ({
  db: {
    // The two reads are told apart by the columns they ask for, which is also
    // the only thing this fake has to know about them.
    select: (cols: Record<string, unknown>) => ({
      from: () => ({
        where: async (condition: unknown) => {
          fx.wheres.push(columnsIn(condition));
          return "crmHouseholdId" in cols ? fx.clientRows : fx.contactRows;
        },
      }),
    }),
  },
}));

import { composeStoryHousehold, loadStoryHousehold } from "../load-context";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const FIRM = "org_firm";

beforeEach(() => {
  fx.clientRows = [{ crmHouseholdId: "hh-1" }];
  fx.contactRows = [
    { role: "primary", firstName: "Cooper", lastName: "Sample" },
    { role: "spouse", firstName: "Susan", lastName: "Sample" },
  ];
  fx.wheres = [];
});

describe("composeStoryHousehold", () => {
  it("names both spouses, and frames the household by the surname", () => {
    expect(
      composeStoryHousehold({ firstName: "Alan", lastName: "Bradshaw", spouseName: "Teresa" }),
    ).toEqual({ firstNames: "Alan and Teresa", householdName: "the Bradshaw household" });
  });

  it("leaves no dangling 'and' for a household with no spouse", () => {
    expect(composeStoryHousehold({ firstName: "Alan", lastName: "Bradshaw" })).toEqual({
      firstNames: "Alan",
      householdName: "the Bradshaw household",
    });
  });

  it("falls back to the first name when there is no surname", () => {
    // The case `scrub.ts` orders its passes around: the household is framed by
    // the GIVEN name, so "the Cooper household" and "Cooper" are the same word.
    expect(composeStoryHousehold({ firstName: "Cooper", lastName: null })).toEqual({
      firstNames: "Cooper",
      householdName: "the Cooper household",
    });
  });

  it("keeps the doubled fallback a household with no name at all produces", () => {
    // Not a typo and not fixed here: this is what the shipped chapters say, and
    // a sample harvested from one of them has to be scrubbed against the same
    // words. Fixing it means fixing the prose first.
    expect(composeStoryHousehold({ firstName: "", lastName: null })).toEqual({
      firstNames: "the household",
      householdName: "the the household household",
    });
  });
});

describe("loadStoryHousehold", () => {
  it("reads the names off the CRM contacts, by role", async () => {
    expect(await loadStoryHousehold(CLIENT, FIRM)).toEqual({
      firstNames: "Cooper and Susan",
      householdName: "the Sample household",
    });
  });

  it("ignores a contact that is neither the primary nor the spouse", async () => {
    fx.contactRows = [
      { role: "child", firstName: "Dana", lastName: "Sample" },
      { role: "primary", firstName: "Cooper", lastName: "Sample" },
    ];
    expect((await loadStoryHousehold(CLIENT, FIRM)).firstNames).toBe("Cooper");
  });

  it("scopes the client read to the firm, not the id alone", async () => {
    await loadStoryHousehold(CLIENT, FIRM);
    expect(fx.wheres[0]).toEqual(expect.arrayContaining(["id", "firm_id"]));
  });

  it("throws rather than returning blank names when the client is not in this firm", async () => {
    // Blank names scrub NOTHING. A caller that cannot learn them must not go on
    // to store text it cannot scrub, so this fails closed.
    fx.clientRows = [];
    await expect(loadStoryHousehold(CLIENT, FIRM)).rejects.toThrow(/not found/);
  });

  it("throws when the household has no primary contact", async () => {
    fx.contactRows = [{ role: "spouse", firstName: "Susan", lastName: "Sample" }];
    await expect(loadStoryHousehold(CLIENT, FIRM)).rejects.toThrow(/no primary CRM contact/);
  });
});

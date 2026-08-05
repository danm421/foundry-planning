import { describe, it, expect, vi, beforeEach } from "vitest";

// Each schema-import access returns a unique sentinel so we can branch in the db mock.
vi.mock("@/db/schema", () => ({
  clients: { _name: "clients" },
  crmHouseholdContacts: { _name: "crmHouseholdContacts" },
  entities: { _name: "entities" },
  familyMembers: { _name: "familyMembers" },
  scenarios: { _name: "scenarios" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  asc: (...a: unknown[]) => a,
}));

// ---------- configurable mock state ----------
let mockClient: Record<string, unknown> | undefined = {
  firmId: "firm-1",
  crmHouseholdId: "hh-1",
  lifeExpectancy: 90,
  portalEditEnabled: true,
};
let mockScenarios: { id: string }[] = [{ id: "s-base" }];
let mockContacts: { role: string; dateOfBirth: string | null }[] = [
  { role: "primary", dateOfBirth: "1976-04-01" },
];
const mockFamilyMembers = [
  { id: "fm-1", role: "client", firstName: "Cooper", dateOfBirth: "1976-04-01" },
];
const mockEntities: { id: string; name: string }[] = [];

function rowsFor(table: string): unknown[] {
  switch (table) {
    case "clients":
      return mockClient ? [mockClient] : [];
    case "scenarios":
      return mockScenarios;
    case "crmHouseholdContacts":
      return mockContacts;
    case "familyMembers":
      return mockFamilyMembers;
    case "entities":
      return mockEntities;
    default:
      return [];
  }
}

/**
 * Every link is itself awaitable AND returns a fresh link, so the fake is
 * order-independent: `.where()`, `.where().limit()` and `.where().orderBy()`
 * all resolve to the same rows. `load-accounts-page.test.ts` branches on the
 * terminator instead (`.where()` returns either a `{ limit }` or a `{ then }`),
 * which cannot serve this loader — it mixes all three shapes, and the two
 * queries ending in `.orderBy()` would be awaited against a non-thenable and
 * hang.
 */
function chainFor(rows: unknown[]) {
  const link = {
    where: () => chainFor(rows),
    orderBy: () => chainFor(rows),
    limit: () => chainFor(rows),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  return link;
}

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => chainFor(rowsFor(tbl._name)) }),
  },
}));

// `vi.hoisted` is required, not stylistic: Vite hoists the `../load-organizer-map`
// import above this file's `const`s, so a bare `const loadEffectiveTree = vi.fn()`
// would still be in its temporal dead zone when the loader pulls in the mocked
// `@/lib/scenario/loader` and the factory dereferences it.
const { loadEffectiveTree } = vi.hoisted(() => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree }));

loadEffectiveTree.mockResolvedValue({
  effectiveTree: {
    client: {
      firstName: "Cooper",
      spouseName: null,
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 90,
      spouseRetirementAge: null,
      spouseLifeExpectancy: null,
    },
    planSettings: { planStartYear: 2026, planEndYear: 2066 },
    accounts: [],
    liabilities: [],
    incomes: [],
    savingsRules: [],
    expenses: [],
  },
  warnings: [],
});

import { loadOrganizerMap } from "../load-organizer-map";

describe("loadOrganizerMap", () => {
  beforeEach(() => {
    mockClient = {
      firmId: "firm-1",
      crmHouseholdId: "hh-1",
      lifeExpectancy: 90,
      portalEditEnabled: true,
    };
    mockScenarios = [{ id: "s-base" }];
    mockContacts = [{ role: "primary", dateOfBirth: "1976-04-01" }];
    loadEffectiveTree.mockClear();
  });

  it("resolves the BASE tree, never a scenario", async () => {
    await loadOrganizerMap("client-1");
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firm-1", "base", {});
  });

  it("returns null when the client has no base-case scenario", async () => {
    mockScenarios = [];
    expect(await loadOrganizerMap("client-1")).toBeNull();
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("returns null when the primary contact has no date of birth", async () => {
    mockContacts = [{ role: "primary", dateOfBirth: null as unknown as string }];
    expect(await loadOrganizerMap("client-1")).toBeNull();
  });

  it("reports canEdit from portalEditEnabled", async () => {
    mockClient = { ...mockClient!, portalEditEnabled: false };
    expect((await loadOrganizerMap("client-1"))!.canEdit).toBe(false);
  });
});

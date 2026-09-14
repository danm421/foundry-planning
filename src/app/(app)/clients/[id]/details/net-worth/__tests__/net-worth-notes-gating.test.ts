// src/app/(app)/clients/[id]/details/net-worth/__tests__/net-worth-notes-gating.test.ts
//
// A toggle-gated note belongs to the scenario whose group gates it, not to the
// base Net Worth screen.
//
// This screen is the one surface with no toggle filter of its own: it loaded
// `loadEffectiveTree` (which resolves gating correctly) AND a separate
// `loadNotesReceivable` against the BASE partition, then handed the SECOND,
// unfiltered set to the balance sheet — which sums it into `totalInEstate`.
// Since every scenario-gated note physically lives on the base partition
// (sale-to-trust writes one there, and so does the solver's save route), each
// one added a full extra note balance to the client's displayed in-estate net
// worth. The rule this pins is already stated at loader.ts:237-244: the base
// view activates no toggle group, so notes pointing at one "belong to non-base
// scenarios (e.g. IDGT sale_to_trust) and shouldn't appear here".
//
// Asserted on the PROPS handed to BalanceSheetView rather than on rendered
// output: the defect is which of two loaded sets the screen chooses, and the
// prop is that choice. A filter inside BalanceSheetView would be the wrong fix
// — the same screen renders SCENARIOS too (`scenarioParam`), where a gated note
// is legitimately visible, so the component cannot know which notes belong.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";
const BASE_SCENARIO_ID = "33333333-3333-4333-8333-333333333333";
const HOUSEHOLD_ID = "44444444-4444-4444-8444-444444444444";

/** Drizzle stamps every table with its SQL name under this well-known symbol. */
const DRIZZLE_NAME = Symbol.for("drizzle:Name");
function tableName(t: unknown): string {
  return (t as Record<symbol, string> | null)?.[DRIZZLE_NAME] ?? "";
}

let rowsByTable: Record<string, unknown[]> = {};

vi.mock("@/db", () => {
  // Every level of the chain is the same thenable, so `.from(t)`,
  // `.from(t).where(...)` and `.from(t).where(...).orderBy(...)` all resolve to
  // the rows seeded for that table. The predicates are not applied — this test
  // asserts on which SET reaches the view, not on any WHERE.
  const chain = (rows: unknown[]) => {
    const node = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    node.where = () => node;
    node.orderBy = () => node;
    return node;
  };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => chain(rowsByTable[tableName(table)] ?? []),
      }),
    },
  };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
// `async () => FIRM_ID`, not `.mockResolvedValue(FIRM_ID)`: vi.mock factories
// are hoisted above the consts, so the id has to be read when the mock is
// CALLED, not when it is built.
vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn(async () => FIRM_ID) }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/scenario/account-meta", () => ({
  loadOverlaidAccountMeta: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/loaders/notes-receivable", () => ({
  loadNotesReceivable: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/investments/load-fund-portfolio-options", () => ({
  loadFundPortfolioOptions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/accounts/load-account-rows", () => ({
  loadAccountMetaRows: vi.fn().mockResolvedValue([]),
  buildAccountRows: vi.fn().mockReturnValue([]),
  linkedSourceMapFrom: vi.fn().mockReturnValue(new Map()),
}));
vi.mock("@/lib/milestones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/milestones")>()),
  buildClientMilestones: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/inflation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inflation")>()),
  resolveInflationRate: vi.fn().mockReturnValue(0.025),
}));
vi.mock("@/lib/investments/category-default-rates", () => ({
  categoryDefaultRates: vi.fn().mockReturnValue({}),
}));
vi.mock("@/lib/investments/default-growth-at-inflation", () => ({
  detectDefaultGrowthAtInflationFor: vi.fn().mockReturnValue(null),
}));

/** Capture stand-in for the balance sheet. Named so the element walk below can
 *  find it by identity. */
function BalanceSheetViewMock() {
  return null;
}
vi.mock("@/components/balance-sheet-view", () => ({ default: BalanceSheetViewMock }));

import { NetWorthContent } from "../net-worth-content";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadNotesReceivable } from "@/lib/loaders/notes-receivable";

type El = { type?: unknown; props?: { children?: unknown } };

/** The BalanceSheetView element in the returned tree, found by component
 *  identity rather than by position, so adding a sibling cannot break it. */
function findBalanceSheet(node: unknown): El | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findBalanceSheet(child);
      if (hit) return hit;
    }
    return null;
  }
  if (node == null || typeof node !== "object") return null;
  const el = node as El;
  if (el.type === BalanceSheetViewMock) return el;
  return findBalanceSheet(el.props?.children);
}

const ungatedNote = () => ({
  id: "note-base",
  name: "Seller-financed note",
  faceValue: 250_000,
  basis: 250_000,
  interestRate: 0.04,
  paymentType: "amortizing" as const,
  startYear: 2024,
  startMonth: 1,
  termMonths: 120,
  linkedTrustEntityId: null,
  toggleGroupId: null,
  extraPayments: [],
  owners: [],
});

const gatedNote = () => ({
  ...ungatedNote(),
  id: "note-gated",
  name: "IDGT installment note",
  faceValue: 1_000_000,
  basis: 1_000_000,
  // Gated by a group that belongs to some OTHER scenario — exactly what the
  // solver's save route writes, and what sale-to-trust has always written.
  toggleGroupId: "group-owned-by-another-scenario",
});

function seedTree(notesReceivable: unknown[]) {
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: {
      client: { firstName: "Cooper", lastName: "Smith" },
      accounts: [],
      liabilities: [],
      incomes: [],
      expenses: [],
      familyMembers: [],
      stockOptionPlans: [],
      notesReceivable,
    },
    resolutionContext: {},
  } as never);
}

beforeEach(() => {
  vi.mocked(loadNotesReceivable).mockClear().mockResolvedValue([]);
  rowsByTable = {
    clients: [{ id: CLIENT_ID, firmId: FIRM_ID, crmHouseholdId: HOUSEHOLD_ID }],
    crm_household_contacts: [
      {
        role: "primary",
        firstName: "Cooper",
        lastName: "Smith",
        dateOfBirth: "1965-03-15",
      },
    ],
    scenarios: [{ id: BASE_SCENARIO_ID, clientId: CLIENT_ID, isBaseCase: true }],
  };
});

async function notesHandedToBalanceSheet(scenarioParam?: string) {
  const tree = await NetWorthContent({ clientId: CLIENT_ID, scenarioParam });
  const el = findBalanceSheet(tree);
  expect(el, "BalanceSheetView was not in the returned tree").not.toBeNull();
  return (el!.props as { notesReceivable?: { id: string }[] }).notesReceivable ?? [];
}

describe("Net Worth — toggle-gated notes receivable", () => {
  it("keeps a gated note off the base balance sheet", async () => {
    // The effective tree has already dropped the gated note for the base view;
    // the screen must show THAT set, not the raw base partition.
    seedTree([ungatedNote()]);
    vi.mocked(loadNotesReceivable).mockResolvedValue([
      ungatedNote(),
      gatedNote(),
    ] as never);

    const notes = await notesHandedToBalanceSheet();

    expect(notes.map((n) => n.id)).toEqual(["note-base"]);
  });

  it("does not read the base partition a second time", async () => {
    // A separate unfiltered load is the defect itself: it filters nothing
    // (loaders/notes-receivable.ts copies toggleGroupId straight through), so
    // every gated row it returns is a full extra balance in totalInEstate — and
    // one more for every "Save as scenario" the advisor runs.
    seedTree([ungatedNote()]);

    await notesHandedToBalanceSheet();

    expect(loadNotesReceivable).not.toHaveBeenCalled();
  });

  it("still shows a scenario's own gated note when viewing that scenario", async () => {
    // The guard is not "hide every gated note" — loadEffectiveTree resolves the
    // group for whichever scenario is being viewed, and a note gated ON in that
    // scenario is legitimately part of it. A blanket toggleGroupId == null
    // filter would wrongly drop this one.
    seedTree([ungatedNote(), gatedNote()]);

    const notes = await notesHandedToBalanceSheet("some-scenario-id");

    expect(notes.map((n) => n.id)).toEqual(["note-base", "note-gated"]);
  });
});

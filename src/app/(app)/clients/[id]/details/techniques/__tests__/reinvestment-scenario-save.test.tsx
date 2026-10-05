// @vitest-environment jsdom
/**
 * Saving a GROUPED base reinvestment unchanged inside a scenario writes no
 * change row — end to end through the real Details loader mapping, the real
 * form, and the real scenario writer. Mocked only at the DB / tree-load
 * boundary.
 *
 * The base tree carries the reinvestment the way `loadClientData` builds it:
 * `accountIds` is the union of the individual picks and the group's members,
 * `pickedAccountIds` the picks alone. The form must send the picks, so the
 * writer diffs picks against picks; sending anything shaped like `accountIds`
 * records a change the advisor never made, which then never auto-reverts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";
const BASE_SCENARIO_ID = "33333333-3333-4333-8333-333333333333";
const SCENARIO_ID = "44444444-4444-4444-8444-444444444444";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");
const tableName = (t: unknown): string => (t as Record<symbol, string> | null)?.[DRIZZLE_NAME] ?? "";

let rowsByTable: Record<string, unknown[]> = {};
/** Every write the scenario writer's transaction issues, as `op table`. */
let writes: string[] = [];

vi.mock("@/db", () => {
  const chain = (rows: unknown[]) => {
    const node = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    node.where = () => node;
    node.orderBy = () => node;
    node.for = () => node;
    return node;
  };
  const select = () => ({ from: (table: unknown) => chain(rowsByTable[tableName(table)] ?? []) });
  const tx = {
    execute: async () => undefined,
    select,
    delete: (table: unknown) => ({
      where: async () => void writes.push(`delete ${tableName(table)}`),
    }),
    insert: (table: unknown) => ({
      values: () => {
        writes.push(`insert ${tableName(table)}`);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
    update: (table: unknown) => ({
      set: () => ({ where: async () => void writes.push(`update ${tableName(table)}`) }),
    }),
  };
  return { db: { select, transaction: async (run: (t: typeof tx) => unknown) => run(tx) } };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`scenario=${SCENARIO_ID}`),
  usePathname: () => `/clients/${CLIENT_ID}/details/techniques`,
}));
vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn(async () => FIRM_ID) }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/authz", () => ({ ForbiddenError: class ForbiddenError extends Error {} }));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn(async () => ({ id: CLIENT_ID })) }));

import { loadTechniquesViewProps } from "../load-view-props";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyEntityEdit } from "@/lib/scenario/changes-writer";
import AddReinvestmentForm from "@/components/forms/add-reinvestment-form";

const account = (id: string, name: string, category: string) => ({
  id, name, category, subType: "x", value: 1000, owners: [], isDefaultChecking: false,
});

/** The scenario has no changes yet, so its effective tree IS the base tree. */
const BASE_TREE = {
  client: { firstName: "Cooper", spouseName: null, dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 95 },
  planSettings: { planStartYear: 2026, planEndYear: 2065 },
  accounts: [account("a-brokerage", "Joint Brokerage", "taxable"), account("a-cash", "Checking", "cash")],
  liabilities: [],
  reinvestments: [
    {
      id: "ri-1",
      name: "Switch",
      // As `loadClientData` builds it: the checking account picked by hand,
      // plus the whole "taxable" group, expanded into the union.
      pickedAccountIds: ["a-cash"],
      groupKeys: ["taxable"],
      accountIds: ["a-cash", "a-brokerage"],
      year: 2035,
      yearRef: null,
      targetType: "model_portfolio",
      realizeTaxesOnSwitch: false,
      newGrowthRate: 0.05,
      soldFractionByAccount: {},
      modelPortfolioId: "mp-1",
      customGrowthRate: null,
      customPctOrdinaryIncome: null,
      customPctLtCapitalGains: null,
      customPctQualifiedDividends: null,
      customPctTaxExempt: null,
    },
  ],
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
const fetchMock = vi.fn<FetchLike>(async (url) =>
  String(url).endsWith("/account-groups")
    ? { ok: true, status: 200, json: async () => [] }
    : { ok: true, status: 200, json: async () => ({}) },
);

beforeEach(() => {
  rowsByTable = {
    clients: [{ id: CLIENT_ID, firmId: FIRM_ID, crmHouseholdId: "h1" }],
    crm_household_contacts: [{ householdId: "h1", role: "primary", dateOfBirth: "1970-01-01" }],
    scenarios: [{ id: BASE_SCENARIO_ID, clientId: CLIENT_ID, isBaseCase: true }],
    model_portfolios: [{ id: "mp-1", name: "Balanced" }],
    scenario_changes: [],
  };
  writes = [];
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: BASE_TREE,
    warnings: [],
    resolutionContext: { resolver: { resolvePortfolio: () => ({ geoReturn: 0.05 }) } },
  } as never);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("a grouped base reinvestment saved unchanged inside a scenario", () => {
  it("writes no change row", async () => {
    const result = await loadTechniquesViewProps(CLIENT_ID, SCENARIO_ID);
    if (result.status !== "ok") throw new Error("expected ok");
    const { accounts, modelPortfolios, reinvestments } = result.props;

    const onSaved = vi.fn();
    render(
      <AddReinvestmentForm
        clientId={CLIENT_ID}
        accounts={accounts}
        modelPortfolios={modelPortfolios}
        initialData={reinvestments[0]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    await screen.findByLabelText(/model portfolio/i);
    fireEvent.submit(document.getElementById("reinvestment-form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/changes"))!;
    expect(url).toBe(`/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes`);
    const { desiredFields } = JSON.parse(init!.body as string);

    // The writer route hands the form's desiredFields to the writer as is.
    await applyEntityEdit({
      scenarioId: SCENARIO_ID,
      firmId: FIRM_ID,
      targetKind: "reinvestment",
      targetId: "ri-1",
      desiredFields,
    });

    // Every field matches base, so the writer takes its idempotent-revert path:
    // it clears any stale edit row and inserts nothing.
    expect(writes).toEqual(["delete scenario_changes"]);
  });
});

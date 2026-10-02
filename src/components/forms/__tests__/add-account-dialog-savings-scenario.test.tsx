// @vitest-environment jsdom
//
// The account dialog's Savings tab inside a scenario. It used to GET the BASE
// `/savings-rules`, so the list showed base values, a rule the scenario added
// was missing, and the nested SavingsRuleDialog opened on base values — whose
// Save then merged every base-equal field out of the scenario's own edit,
// silently reverting it. Inside a scenario the page now hands the dialog the
// scenario's effective rules (threaded AddAccountDialog → AddAccountForm,
// unmocked) and the tab issues no GET. Base mode still reads the route.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let searchParams = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/solver",
}));

import AddAccountDialog from "@/components/add-account-dialog";
import type { SavingsRuleRow } from "../savings-rule-dialog";

const ACCOUNT = {
  id: "acct-401k",
  name: "Alice 401k",
  category: "retirement" as const,
  subType: "traditional_401k",
  owner: "client" as const,
  value: "100000",
  basis: "0",
  growthRate: "0.05",
  owners: [{ kind: "family_member" as const, familyMemberId: "fm-c", percent: 1 }],
};

const rule = (over: Partial<SavingsRuleRow>): SavingsRuleRow => ({
  id: "sr-1",
  accountId: ACCOUNT.id,
  annualAmount: "6000",
  startYear: 2026,
  endYear: 2040,
  employerMatchPct: null,
  employerMatchCap: null,
  employerMatchAmount: null,
  ...over,
});

/** The scenario's effective rules: a base rule the scenario raised to $9,000, a
 *  rule the scenario added, and another account's rule. */
const SCENARIO_RULES = [
  rule({ annualAmount: "9000" }),
  rule({ id: "sr-added", annualAmount: "2500" }),
  rule({ id: "sr-other", accountId: "acct-other", annualAmount: "1000" }),
];

let fetchMock: ReturnType<typeof vi.fn>;
const savingsRuleReads = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith("/savings-rules") && ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
  );

beforeEach(() => {
  searchParams = new URLSearchParams("");
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    // The base route's answer: the un-raised $6,000 rule only.
    json: async () => (String(url).endsWith("/savings-rules") ? [rule({})] : []),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog() {
  render(
    <AddAccountDialog
      clientId="c1"
      category="retirement"
      open
      onOpenChange={() => {}}
      editing={ACCOUNT}
      familyMembers={[{ id: "fm-c", role: "client", firstName: "Alice" }]}
      savingsRules={SCENARIO_RULES}
      initialTab="savings"
    />,
  );
}

describe("Account dialog → Savings tab", () => {
  it("inside a scenario: lists the scenario's rules for this account, with no base GET", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderDialog();

    expect(await screen.findByText("$9,000/yr")).toBeInTheDocument();
    expect(screen.getByText("$2,500/yr")).toBeInTheDocument();
    expect(screen.queryByText("$6,000/yr")).toBeNull();
    expect(screen.queryByText("$1,000/yr")).toBeNull();
    expect(savingsRuleReads()).toEqual([]);
  });

  it("inside a scenario: the nested rule dialog opens on the scenario's value", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderDialog();

    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    expect(await screen.findByDisplayValue("9000")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("6000")).toBeNull();
  });

  it("on the base plan: still reads the base route", async () => {
    renderDialog();

    expect(await screen.findByText("$6,000/yr")).toBeInTheDocument();
    await waitFor(() => expect(savingsRuleReads()).toHaveLength(1));
  });
});

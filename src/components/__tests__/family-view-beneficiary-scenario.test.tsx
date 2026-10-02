// @vitest-environment jsdom
//
// Details → Profile → Beneficiary Summary → Edit opens the account form locked
// to its Beneficiaries tab. Inside a scenario that tab opens on the scenario's
// own designations and pick lists (never the base GETs), so one Save keeps the
// existing rows and adds the new one instead of replacing the whole set.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

const searchParams = new URLSearchParams("scenario=scn-1");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/details/family",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/entity-dialog", () => ({ default: () => null }));
vi.mock("@/components/revocable-trust-tag-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-client-dialog", () => ({ default: () => null }));
vi.mock("@/components/family-member-dialog", () => ({ default: () => null }));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/investments/holdings-client", () => ({ refreshClientHoldingPrices: vi.fn() }));
vi.mock("@/components/beneficiary-summary", () => ({
  default: ({ onEditAccount }: { onEditAccount?: (id: string) => void }) => (
    <button type="button" onClick={() => onEditAccount?.("a1")}>open beneficiaries</button>
  ),
}));
// The real tab, fed whatever the page hands the dialog.
vi.mock("@/components/add-account-dialog", async () => {
  const { default: Tab } = await import("@/components/forms/beneficiaries-tab");
  return {
    default: ({ editing, beneficiaryPickLists, onOpenChange }: {
      editing?: { id: string; beneficiaries?: never };
      beneficiaryPickLists?: never;
      onOpenChange?: (o: boolean) => void;
    }) =>
      editing ? (
        <div>
          <button type="button" onClick={() => onOpenChange?.(false)}>close dialog</button>
          <Tab clientId="c1" accountId={editing.id} active scenarioBeneficiaries={editing.beneficiaries} pickLists={beneficiaryPickLists} />
        </div>
      ) : null,
  };
});

import FamilyView from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

const REF = { id: "ref-1", tier: "primary" as const, percentage: 100, householdRole: "client" as const, sortOrder: 0 };

let fetchMock: ReturnType<typeof vi.fn>;
const requestList = () =>
  fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}`);

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const PRIMARY = { firstName: "Alice", lastName: "T", dateOfBirth: "1960-01-01", retirementAge: 67, lifeExpectancy: 95, filingStatus: "single", spouseName: null as string | null, spouseLastName: null as string | null, spouseDob: null, spouseRetirementAge: null, spouseLifeExpectancy: null };

function pageProps(over: Record<string, unknown> = {}) {
  return {
    clientId: "c1",
    primary: PRIMARY,
    initialMembers: [],
    initialEntities: [{ id: "t1", name: "Renamed Trust", entityType: "trust" }],
    initialExternalBeneficiaries: [],
    initialAccounts: [{ id: "a1", name: "Brokerage", category: "taxable", value: 1, subType: "brokerage", ownerFamilyMemberId: null, ownerEntityId: null, beneficiaries: [REF] }],
    initialDesignations: [],
    initialGifts: [],
    initialGiftSeries: [],
    annualExclusionByYear: {},
    planStartYear: 2026,
    scenarioId: "base-scn",
    contacts: null,
    ...over,
  } as unknown as React.ComponentProps<typeof FamilyView>;
}

const tree = (props: React.ComponentProps<typeof FamilyView>) => (
  <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
    <FamilyView {...props} />
  </ClientAccessProvider>
);

const postedRefs = () => {
  const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return JSON.parse((posts[posts.length - 1][1] as RequestInit).body as string).desiredFields.beneficiaries as Array<{ id: string; tier: string }>;
};

describe("Beneficiary Summary → Edit, inside a scenario", () => {
  it("opens on the scenario's designations and keeps them when a row is added", async () => {
    await act(async () => { render(tree(pageProps())); });
    fireEvent.click(screen.getByRole("button", { name: "open beneficiaries" }));

    expect(await screen.findByText("sum: 100.00%")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Renamed Trust" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ add contingent" }));
    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
    await waitFor(() => expect(requestList().some((l) => l.startsWith("POST "))).toBe(true));

    const refs = postedRefs();
    expect(refs.map((r) => r.tier)).toEqual(["primary", "contingent"]);
    expect(refs[0]).toMatchObject({ id: "ref-1", householdRole: "client" });
    // No base GET for the designations or the pick lists, no base PUT.
    expect(requestList().filter((l) => l.includes("/beneficiaries") || l.includes("family-members") || l.includes("/entities"))).toEqual([]);
  });

  it("reopens on the SAVED rows after the page refreshes, and the next save keeps them", async () => {
    let utils!: ReturnType<typeof render>;
    await act(async () => { utils = render(tree(pageProps())); });
    fireEvent.click(screen.getByRole("button", { name: "open beneficiaries" }));
    await screen.findByText("sum: 100.00%");
    fireEvent.click(screen.getByRole("button", { name: "+ add contingent" }));
    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
    await waitFor(() => expect(requestList().some((l) => l.startsWith("POST "))).toBe(true));
    const saved = postedRefs();
    fireEvent.click(screen.getByRole("button", { name: "close dialog" }));

    // The router refresh hands the page the saved designations.
    const refreshed = pageProps({
      initialAccounts: [{ id: "a1", name: "Brokerage", category: "taxable", value: 1, subType: "brokerage", ownerFamilyMemberId: null, ownerEntityId: null, beneficiaries: saved }],
    });
    await act(async () => { utils.rerender(tree(refreshed)); });
    fireEvent.click(screen.getByRole("button", { name: "open beneficiaries" }));

    await waitFor(() => expect(screen.getAllByText(/^sum: /)).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "+ add contingent" }));
    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
    await waitFor(() => expect(requestList().filter((l) => l.startsWith("POST ")).length).toBe(2));
    expect(postedRefs().map((r) => r.tier)).toEqual(["primary", "contingent", "contingent"]);
  });

  it("lists the client and spouse by name for a married household", async () => {
    await act(async () => {
      render(tree(pageProps({ primary: { ...PRIMARY, spouseName: "Bob", spouseLastName: "T" } })));
    });
    fireEvent.click(screen.getByRole("button", { name: "open beneficiaries" }));
    await screen.findByText("sum: 100.00%");
    const household = screen.getByRole("group", { name: "Household" });
    expect(Array.from(household.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Alice T", "Bob T"]);
  });

  it("lists a member and a charity the scenario added in the pick lists, with no base GET", async () => {
    await act(async () => {
      render(
        tree(
          pageProps({
            initialMembers: [{ id: "fm-scn", firstName: "Zed", lastName: "T", relationship: "child", role: "child", dateOfBirth: null, notes: null }],
            initialExternalBeneficiaries: [{ id: "ext-scn", name: "Scenario Library", kind: "charity", notes: null }],
          }),
        ),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "open beneficiaries" }));
    await screen.findByText("sum: 100.00%");
    expect(screen.getByRole("option", { name: /Zed/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Scenario Library (charity)" })).toBeInTheDocument();
    expect(requestList().filter((l) => l.includes("family-members") || l.includes("external-beneficiaries"))).toEqual([]);
  });
});

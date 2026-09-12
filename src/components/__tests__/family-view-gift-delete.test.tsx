// @vitest-environment jsdom
//
// Deleting a gift from Details → Profile is a WRITE, so it follows the active
// scenario like every other write on the page: `useScenarioWriter` turns it into
// a `remove` scenario change when `?scenario=` is in the URL, and calls the
// legacy gift routes when it is not.
//
// Both halves matter. The scenario half is what stops a what-if delete from
// erasing a gift out of the base plan. The base half is the regression guard —
// with no scenario active the request must be byte-for-byte the one advisors
// have been sending all along.
//
// Scenario state is driven through the URL, the way the hook actually reads it.
// `use-scenario-writer` is deliberately NOT mocked here: mocking it would leave
// the branch these tests exist to pin untested.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

/** `?scenario=` decides the write mode. Reassigned per test, read at call time. */
let searchParams = new URLSearchParams("");
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock, replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/test-client-id/details/family",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// FamilyView is heavy — mock the leaf dialogs and 3rd-party libs, never the
// gating logic and never the writer under test.
vi.mock("@/components/add-account-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/entity-dialog", () => ({ default: () => null }));
vi.mock("@/components/revocable-trust-tag-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-client-dialog", () => ({ default: () => null }));
vi.mock("@/components/beneficiary-summary", () => ({ default: () => null }));
vi.mock("@/components/family-member-dialog", () => ({ default: () => null }));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/investments/holdings-client", () => ({ refreshClientHoldingPrices: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import FamilyView from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { Gift, GiftSeriesLite } from "@/components/family-view";

const CLIENT_ID = "test-client-id";
/** The scenario the PAGE resolved server-side. In base mode this is the base
 *  case, and the scenario-scoped series route still takes it — it is not what
 *  puts the write in scenario mode. The URL is. */
const RESOLVED_SCENARIO_ID = "base-scn";

const PRIMARY_INFO = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1960-05-15",
  retirementAge: 67,
  lifeExpectancy: 95,
  filingStatus: "single",
  spouseName: null,
  spouseLastName: null,
  spouseDob: null,
  spouseRetirementAge: null,
  spouseLifeExpectancy: null,
};

const CHILD_MEMBER = {
  id: "fm-child",
  firstName: "Bob",
  lastName: "Test",
  relationship: "child" as const,
  dateOfBirth: "2015-01-01",
  notes: null,
  claimedAsDependent: "auto" as const,
};

const GIFT: Gift = {
  id: "g1",
  year: 2026,
  amount: 50000,
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: "fm-child",
  recipientExternalBeneficiaryId: null,
  accountId: null,
  percent: null,
  valuationDiscount: null,
  useCrummeyPowers: false,
  notes: null,
} as unknown as Gift;

const SERIES: GiftSeriesLite = {
  id: "gs1",
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: "fm-child",
  recipientExternalBeneficiaryId: null,
  startYear: 2026,
  endYear: 2030,
  annualAmount: 19000,
  amountMode: "fixed",
  inflationAdjust: false,
  valuationDiscount: null,
  useCrummeyPowers: false,
} as unknown as GiftSeriesLite;

function baseProps() {
  return {
    clientId: CLIENT_ID,
    primary: PRIMARY_INFO,
    initialMembers: [CHILD_MEMBER],
    initialEntities: [],
    initialExternalBeneficiaries: [],
    initialAccounts: [],
    initialDesignations: [],
    initialGifts: [GIFT],
    initialGiftSeries: [SERIES],
    annualExclusionByYear: {},
    planStartYear: 2026,
    scenarioId: RESOLVED_SCENARIO_ID,
    contacts: null,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Every write the page made, in order. FamilyView reads on mount too. */
function writeCalls(): Array<{ url: string; method: string; body: unknown }> {
  return fetchMock.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? "GET",
      body: (() => {
        const b = (init as RequestInit | undefined)?.body;
        return typeof b === "string" ? JSON.parse(b) : b;
      })(),
    }))
    .filter((c) => c.method !== "GET");
}

async function renderPage() {
  await act(async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <FamilyView {...baseProps()} />
      </ClientAccessProvider>,
    );
  });
  // Both Delete buttons inside the Gifts section: [0] the one-time gift's,
  // [1] the series'. Scoped to the section so an unrelated Delete elsewhere on
  // the page can never be the one clicked.
  const giftsSection = screen.getByText("Gifts").closest("section") as HTMLElement;
  return within(giftsSection).getAllByText("Delete");
}

describe("FamilyView — deleting a gift follows the active scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("");
    // `[]` not `{}` — FamilyView GETs a list on mount (the revocable-trust tag
    // panel) and maps over the result.
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("deletes a gift on the base gift route with no scenario active (behavior unchanged)", async () => {
    const [deleteGiftBtn] = await renderPage();
    await act(async () => { fireEvent.click(deleteGiftBtn); });
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/g1`);
    expect(call.method).toBe("DELETE");
    // Not the scenario changes route, and no scenario param smuggled in.
    expect(call.url).not.toContain("/scenarios/");
    expect(call.url).not.toContain("?scenario=");

    // The row still leaves the list optimistically, as before.
    await waitFor(() => expect(screen.queryByText("$50,000")).toBeNull());
  });

  it("deletes a gift as a scenario `remove` change when a scenario is active", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    const [deleteGiftBtn] = await renderPage();
    await act(async () => { fireEvent.click(deleteGiftBtn); });
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/scenarios/scn-1/changes`);
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ op: "remove", targetKind: "gift", targetId: "g1" });
    // The base `gifts` row is never touched from inside a scenario.
    for (const c of writeCalls()) expect(c.url).not.toContain(`/gifts/g1`);
  });

  it("deletes a gift series on the base series route with no scenario active (behavior unchanged)", async () => {
    const [, deleteSeriesBtn] = await renderPage();
    await act(async () => { fireEvent.click(deleteSeriesBtn); });
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    // `gift_series` is itself scenario-scoped (schema.ts: `scenario_id NOT
    // NULL`), so its base route legitimately carries the page's resolved
    // scenario. That param is NOT what makes a write scenario-mode.
    expect(call.url).toBe(
      `/api/clients/${CLIENT_ID}/gifts/series/gs1?scenario=${RESOLVED_SCENARIO_ID}`,
    );
    expect(call.method).toBe("DELETE");
    expect(call.url).not.toContain("/scenarios/");

    await waitFor(() => expect(screen.queryByText("$19,000/yr")).toBeNull());
  });

  it("deletes a gift series through the series route, NOT as a `remove` change, when a scenario is active", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    const [, deleteSeriesBtn] = await renderPage();
    await act(async () => { fireEvent.click(deleteSeriesBtn); });
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    // `gift_series` is PARTITIONED, not overlaid: the row carries a real
    // `scenario_id` and this list only ever shows the active scenario's
    // series, so the direct DELETE already IS the scenario-correct delete.
    // A `remove` change left the row alive — back on reload, and copied into
    // the base plan by `copyGiftSeriesToBase` when the scenario is promoted,
    // resurrecting a series the advisor deleted.
    expect(call.url).toBe(
      `/api/clients/${CLIENT_ID}/gifts/series/gs1?scenario=${RESOLVED_SCENARIO_ID}`,
    );
    expect(call.method).toBe("DELETE");
    for (const c of writeCalls()) expect(c.url).not.toContain("/scenarios/");

    await waitFor(() => expect(screen.queryByText("$19,000/yr")).toBeNull());
  });
});

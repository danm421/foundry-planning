// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE row's Family dialog.
 *
 * With `focus` set the view must render only the dialog the page itself opens
 * for that row, seeded with that row, and hand control back through
 * `onFocusClose` whenever that dialog goes away (cancel, save) or never could
 * open — the row is missing, its kind isn't edited here, the advisor has
 * view-only access, or it's a family member (its dialog is seeded from the
 * base plan, so a save would revert the scenario's change) or an external
 * beneficiary (its editor can write the base plan even inside a scenario) —
 * all "unavailable" — or it's a gift series, whose editor can write the base
 * plan too ("unsupported", Ruling F-I2).
 *
 * The Solver is always inside a scenario, so `?scenario=` is in the URL and
 * `use-scenario-writer` is NOT mocked: the save tests pin that each focused
 * dialog writes to the scenario, not the base plan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const SCENARIO_ID = "scn-1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`scenario=${SCENARIO_ID}`),
  usePathname: () => "/clients/c-1/solver",
}));

// The client dialog's form reads the signed-in user; the app wraps it in
// ClerkProvider, this test doesn't.
vi.mock("@clerk/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/nextjs")>()),
  useUser: () => ({ user: { id: "user-1" } }),
}));

import FamilyView, {
  type Entity,
  type FamilyViewProps,
  type Gift,
  type GiftSeriesLite,
} from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CLIENT_ID = "c-1";

const TRUST: Entity = {
  id: "ent-ilit",
  name: "Test Family ILIT",
  entityType: "trust",
  notes: null,
  includeInPortfolio: false,
  isGrantor: false,
  grantorStatusEndYear: null,
  value: "0",
  basis: "0",
  owners: [],
  owner: null,
  grantor: "client",
  beneficiaries: null,
  trustSubType: "ilit",
  isIrrevocable: true,
  trustee: "First Trust Co",
  trustEnds: "client_death",
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
};

const GIFT: Gift = {
  id: "gift-1",
  year: 2027,
  amount: 50000,
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: "fm-child",
  recipientExternalBeneficiaryId: null,
  accountId: null,
  percent: null,
  valuationDiscount: null,
  useCrummeyPowers: false,
  eventKind: "outright",
  businessEntityId: null,
  liabilityId: null,
  notes: null,
};

const SERIES: GiftSeriesLite = {
  id: "series-1",
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: "fm-child",
  recipientExternalBeneficiaryId: null,
  startYear: 2026,
  endYear: 2031,
  annualAmount: 19000,
  amountMode: "fixed",
  inflationAdjust: false,
  valuationDiscount: null,
  useCrummeyPowers: false,
};

const PROPS: FamilyViewProps = {
  clientId: CLIENT_ID,
  primary: {
    firstName: "Alice",
    lastName: "Test",
    dateOfBirth: "1960-05-15",
    retirementAge: 67,
    retirementMonth: 1,
    lifeExpectancy: 93,
    filingStatus: "single",
    spouseName: null,
    spouseLastName: null,
    spouseDob: null,
    spouseRetirementAge: null,
    spouseRetirementMonth: null,
    spouseLifeExpectancy: null,
  },
  initialMembers: [
    {
      id: "fm-child",
      firstName: "Bobby",
      lastName: "Test",
      relationship: "child",
      role: "child",
      dateOfBirth: "2015-01-01",
      notes: null,
      claimedAsDependent: "auto",
    },
  ],
  initialEntities: [TRUST],
  initialExternalBeneficiaries: [{ id: "ext-1", name: "Red Cross", kind: "charity", notes: null }],
  initialAccounts: [],
  initialDesignations: [],
  initialGifts: [GIFT],
  initialGiftSeries: [SERIES],
  annualExclusionByYear: { 2026: 19000, 2027: 19000 },
  planStartYear: 2026,
  scenarioId: SCENARIO_ID,
  initialFullAccounts: [],
  initialFullLiabilities: [],
  initialFullIncomes: [],
  initialFullExpenses: [],
  initialFullBusinesses: [],
  initialAssetFamilyMembers: [],
  contacts: null,
};

function renderFocused(
  focus: EditorFocus,
  onFocusClose = vi.fn(),
  permission: "view" | "edit" = "edit",
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <FamilyView {...PROPS} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
  return { ...utils, onFocusClose };
}

const dialog = (title: string) => within(screen.getByRole("dialog", { name: title }));
const inputValue = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

/** Every section header focus mode must leave out. */
function expectNoPageChrome() {
  for (const title of [
    "Household",
    "Family Members",
    "Trusts",
    "Revocable Trusts",
    "External Beneficiaries",
    "Gifts",
  ]) {
    expect(screen.queryByRole("heading", { name: title })).toBeNull();
  }
}

type Focused = { container: HTMLElement; onFocusClose: ReturnType<typeof vi.fn> };

/** Nothing opened: `onFocusClose(outcome)` once, and nothing rendered. */
async function expectNothingOpened(utils: Focused, outcome: "unavailable" | "unsupported") {
  await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));
  expect(utils.onFocusClose).toHaveBeenCalledWith(outcome);
  expect(utils.container).toBeEmptyDOMElement();
}
const expectUnavailable = (utils: Focused) => expectNothingOpened(utils, "unavailable");

type FetchInit = { method?: string; body?: string } | undefined;
type FetchLike = (url: string, init?: FetchInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
const fetchMock = vi.fn<FetchLike>();

/** The scenario-changes POSTs the page made, parsed. */
function scenarioChangeBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === `/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes` && init?.method === "POST")
    .map(([, init]) => JSON.parse(init!.body!) as Record<string, unknown>);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => {
    if (url.endsWith("/changes")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    // Every read the dialogs make on mount (trust gifts/flow overrides, …).
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Which dialog opens
// ---------------------------------------------------------------------------

describe("FamilyView focus mode — which dialog opens", () => {
  it("client → the Edit Client dialog, pre-filled with the effective client, and nothing else", () => {
    // Checks Life Expectancy pre-fills too, not just firstName — confirming
    // the dialog is seeded from the full client record. (A plan_settings
    // change carrying planEndYear no longer arrives here as the client focus:
    // Ruling T4d-horizon routes it to the Solver's Retirement tab instead.)
    renderFocused({ kind: "client", id: CLIENT_ID });

    const client = dialog("Edit Client");
    expect(inputValue("firstName")).toBe("Alice");
    expect((client.getByLabelText("Life Expectancy (age)") as HTMLInputElement).value).toBe("93");
    expectNoPageChrome();
  });

  it("entity → the Edit Trust dialog, pre-filled with that trust, and nothing else", () => {
    renderFocused({ kind: "entity", id: "ent-ilit" });

    expect(screen.getByRole("dialog", { name: "Edit Trust" })).toBeTruthy();
    expect(inputValue("trust-name")).toBe("Test Family ILIT");
    expectNoPageChrome();
  });

  it("gift → the Edit gift dialog, pre-filled with that one-time gift, and nothing else", () => {
    renderFocused({ kind: "gift", id: "gift-1" });

    const gift = dialog("Edit gift");
    expect((gift.getByTestId("recipient") as HTMLSelectElement).value).toBe("family_member:fm-child");
    expect((gift.getByLabelText(/amount/i, { selector: "input" }) as HTMLInputElement).value).toMatch(/50,?000/);
    expectNoPageChrome();
  });

  it("does not load the page's revocable-trust list, which only its table shows", async () => {
    renderFocused({ kind: "entity", id: "ent-ilit" });

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Edit Trust" })).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => url.includes("revocable-trusts"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

describe("FamilyView focus mode — unavailable", () => {
  it("a row that isn't there → onFocusClose(\"unavailable\") once, nothing rendered", async () => {
    const utils = renderFocused({ kind: "entity", id: "gone" });

    await expectUnavailable(utils);

    // A parent re-render with fresh inline props must not close it again.
    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <FamilyView {...PROPS} focus={{ kind: "entity", id: "gone" }} onFocusClose={utils.onFocusClose} />
      </ClientAccessProvider>,
    );
    expect(utils.onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("a kind this view doesn't edit → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "fm-child" }));
  });

  it("an id that belongs to another kind → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "entity", id: "fm-child" }));
  });

  it("a client id that isn't this client → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "client", id: "someone-else" }));
  });

  // Ruling T4d-member: the page lists members from the base table, so the
  // dialog opens on base values and a save would revert the scenario's edit.
  it("a family member → unavailable, even though the row is there", async () => {
    await expectUnavailable(renderFocused({ kind: "family_member", id: "fm-child" }));
  });

  // Its inline row form PATCHes the base table with a bare fetch, so a save
  // inside a scenario would rewrite the base plan.
  it("an external beneficiary → unavailable, even though the row is there", async () => {
    await expectUnavailable(renderFocused({ kind: "external_beneficiary", id: "ext-1" }));
  });

  it("without edit permission → unavailable, as the page offers no editor either", async () => {
    await expectUnavailable(renderFocused({ kind: "entity", id: "ent-ilit" }, vi.fn(), "view"));
  });
});

// Ruling F-I2: rows whose editor is known to write the base plan inside a
// scenario report "unsupported" — the host shows no Details-page link, as the
// page carries the same bug.
describe("FamilyView focus mode — unsupported", () => {
  // A series a change points at is that change's overlay row, and the series
  // dialog PATCHes `gift_series` by id alone — a base series' id rewrites the
  // base plan. (The one-time side of the same kind opens: see above.)
  it("a gift series → unsupported, even though the row is there", async () => {
    await expectNothingOpened(renderFocused({ kind: "gift", id: "series-1" }), "unsupported");
  });

  it("without edit permission a gift series is unavailable, like every row", async () => {
    await expectUnavailable(renderFocused({ kind: "gift", id: "series-1" }, vi.fn(), "view"));
  });
});

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe("FamilyView focus mode — closing", () => {
  // A normal close carries no outcome at all — not even an explicit undefined.
  it.each([
    { focus: { kind: "client" as const, id: CLIENT_ID }, title: "Edit Client" },
    { focus: { kind: "entity" as const, id: "ent-ilit" }, title: "Edit Trust" },
    { focus: { kind: "gift" as const, id: "gift-1" }, title: "Edit gift" },
  ])("cancelling the $title dialog ($focus.id) calls onFocusClose()", ({ focus, title }) => {
    const { onFocusClose } = renderFocused(focus);
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(dialog(title).getByRole("button", { name: "Cancel" }));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("asking to delete a trust opens the confirm and keeps focus open", () => {
    const { onFocusClose } = renderFocused({ kind: "entity", id: "ent-ilit" });

    fireEvent.click(dialog("Edit Trust").getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog", { name: "Delete Trust" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit Trust" })).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it("a successful client save writes a scenario client edit, then calls onFocusClose()", async () => {
    const { onFocusClose } = renderFocused({ kind: "client", id: CLIENT_ID });

    fireEvent.submit(document.getElementById("add-client-form") as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "edit", targetKind: "client", targetId: CLIENT_ID }),
    ]);
  });

  it("a successful trust save writes a scenario entity edit, then calls onFocusClose()", async () => {
    const { onFocusClose } = renderFocused({ kind: "entity", id: "ent-ilit" });

    fireEvent.submit(document.getElementById("add-trust-form") as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "edit", targetKind: "entity", targetId: "ent-ilit" }),
    ]);
  });

  it("a successful one-time gift save writes a scenario gift, then calls onFocusClose()", async () => {
    const { onFocusClose } = renderFocused({ kind: "gift", id: "gift-1" });

    fireEvent.click(dialog("Edit gift").getByRole("button", { name: "Save gift" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    // Gifts have no edit op: an edit is an `add` re-using the gift's own id.
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "add", targetKind: "gift", entity: expect.objectContaining({ id: "gift-1" }) }),
    ]);
  });
});

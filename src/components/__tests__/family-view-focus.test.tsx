// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE row's Family dialog.
 *
 * With `focus` set the view must render only the dialog the page itself opens
 * for that row, seeded with that row, and hand control back through
 * `onFocusClose` whenever that dialog goes away (cancel, save) or never could
 * open — the row is missing, its kind isn't edited here, the advisor has
 * view-only access — all "unavailable" — or it's a gift series, whose editor
 * can write the base plan ("unsupported", Ruling F-I2).
 *
 * The Solver is always inside a scenario, so `?scenario=` is in the URL and
 * `use-scenario-writer` is NOT mocked: the save tests pin that each focused
 * dialog writes to the scenario, not the base plan.
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

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

/** A recurring gift the scenario's own `gift` change made — the only kind of
 *  series the Solver opens. SERIES above is a real `gift_series` row. */
const OVERLAY_SERIES: GiftSeriesLite = { ...SERIES, id: "series-ov", annualAmount: 7000, overlay: true };

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
  initialGiftSeries: [SERIES, OVERLAY_SERIES],
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

  it("family_member → the Edit Family Member dialog, pre-filled with that member, and nothing else", () => {
    renderFocused({ kind: "family_member", id: "fm-child" });

    expect(screen.getByRole("dialog", { name: "Edit Family Member" })).toBeTruthy();
    expect(inputValue("fm-first")).toBe("Bobby");
    expect(inputValue("fm-last")).toBe("Test");
    expectNoPageChrome();
  });

  it("external_beneficiary → the Edit Charity dialog, pre-filled with that charity, and nothing else", () => {
    renderFocused({ kind: "external_beneficiary", id: "ext-1" });

    expect(screen.getByRole("dialog", { name: "Edit Charity / External Beneficiary" })).toBeTruthy();
    expect(inputValue("ext-name")).toBe("Red Cross");
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

  it("a family member that isn't there → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "family_member", id: "gone" }));
  });

  it("an external beneficiary that isn't there → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "external_beneficiary", id: "gone" }));
  });

  it("without edit permission → unavailable, as the page offers no editor either", async () => {
    await expectUnavailable(renderFocused({ kind: "entity", id: "ent-ilit" }, vi.fn(), "view"));
  });
});

// A series in the scenario's own `gift_series` partition is edited only by the
// Details page (a partition write), so the Solver offers no link to it. An
// overlay series — the scenario's own `gift` change — opens.
describe("FamilyView focus mode — recurring gifts", () => {
  it("an overlay series → the Edit gift dialog, pre-filled with that series, and nothing else", () => {
    renderFocused({ kind: "gift", id: "series-ov" });

    const gift = dialog("Edit gift");
    expect((gift.getByLabelText(/amount/i, { selector: "input" }) as HTMLInputElement).value).toMatch(/7,?000/);
    expectNoPageChrome();
  });

  it("saving an overlay series writes ONE scenario gift add under its id, never the series route", async () => {
    const { onFocusClose } = renderFocused({ kind: "gift", id: "series-ov" });

    fireEvent.click(dialog("Edit gift").getByRole("button", { name: "Save gift" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({
        op: "add",
        targetKind: "gift",
        entity: expect.objectContaining({ kind: "series", id: "series-ov" }),
      }),
    ]);
    // The whole request list: nothing but that one change POST reaches a write.
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
    expect(writes).toHaveLength(1);
  });

  it("a partition series → unsupported, even though the row is there", async () => {
    await expectNothingOpened(renderFocused({ kind: "gift", id: "series-1" }), "unsupported");
  });

  it("without edit permission an overlay series is unavailable, like every row", async () => {
    await expectUnavailable(renderFocused({ kind: "gift", id: "series-ov" }, vi.fn(), "view"));
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

// ---------------------------------------------------------------------------
// Create and delete intents
// ---------------------------------------------------------------------------

describe("FamilyView focus mode — create and delete intents", () => {
  const LLC: Entity = { ...TRUST, id: "ent-llc", name: "Test Holdings LLC", entityType: "llc", trustSubType: null };
  const WITH_LLC: FamilyViewProps = { ...PROPS, initialEntities: [TRUST, LLC] };

  function renderWith(props: FamilyViewProps, focus: EditorFocus, onFocusClose = vi.fn()) {
    const utils = render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <FamilyView {...props} focus={focus} onFocusClose={onFocusClose} />
      </ClientAccessProvider>,
    );
    return { ...utils, onFocusClose };
  }

  // EntityDialog always renders AddTrustForm, whose save refuses every create
  // inside a scenario, so the Solver never offers it; this is the safety net.
  it("create entity → unsupported, nothing rendered", async () => {
    await expectNothingOpened(renderFocused({ intent: "create", kind: "entity" }), "unsupported");
  });

  it("create gift opens the empty Add a gift dialog alone, and cancel closes", () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "gift" });

    expect(screen.getByRole("dialog", { name: "Add a gift" })).toBeTruthy();
    expectNoPageChrome();
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(dialog("Add a gift").getByRole("button", { name: "Cancel" }));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("create gift saves a scenario gift add, then closes with no outcome", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "gift" });
    const gift = dialog("Add a gift");

    fireEvent.change(gift.getByTestId("recipient"), { target: { value: "family_member:fm-child" } });
    fireEvent.change(gift.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "10000" } });
    fireEvent.click(gift.getByRole("button", { name: "Add gift" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "add", targetKind: "gift", entity: expect.objectContaining({ amount: 10000 }) }),
    ]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("create client → unavailable", async () => {
    await expectUnavailable(renderFocused({ intent: "create", kind: "client" }));
  });

  it("create family_member opens the empty Add Family Member dialog alone, and cancel closes", () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "family_member" });

    expect(screen.getByRole("dialog", { name: "Add Family Member" })).toBeTruthy();
    expect(inputValue("fm-first")).toBe("");
    expectNoPageChrome();
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(dialog("Add Family Member").getByRole("button", { name: "Cancel" }));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("create family_member saves a scenario add, nothing else, then closes with no outcome", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "family_member" });

    fireEvent.change(document.getElementById("fm-first")!, { target: { value: "Tom" } });
    fireEvent.click(dialog("Add Family Member").getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({
        op: "add",
        targetKind: "family_member",
        entity: expect.objectContaining({ firstName: "Tom", lastName: null }),
      }),
    ]);
  });

  it("create external_beneficiary saves a scenario add, nothing else, then closes with no outcome", async () => {
    const { onFocusClose } = renderFocused({ intent: "create", kind: "external_beneficiary" });
    expect(screen.getByRole("dialog", { name: "Add Charity / External Beneficiary" })).toBeTruthy();

    fireEvent.change(document.getElementById("ext-name")!, { target: { value: "Library" } });
    fireEvent.click(dialog("Add Charity / External Beneficiary").getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({
        op: "add",
        targetKind: "external_beneficiary",
        entity: expect.objectContaining({ name: "Library", kind: "charity", charityType: "public" }),
      }),
    ]);
  });

  it("edit family_member saves a scenario edit, nothing else, then closes with no outcome", async () => {
    const { onFocusClose } = renderFocused({ kind: "family_member", id: "fm-child" });

    fireEvent.change(document.getElementById("fm-first")!, { target: { value: "Robert" } });
    fireEvent.click(dialog("Edit Family Member").getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({
        op: "edit",
        targetKind: "family_member",
        targetId: "fm-child",
        desiredFields: expect.objectContaining({ firstName: "Robert" }),
      }),
    ]);
  });

  it("edit external_beneficiary saves a scenario edit, nothing else, then closes with no outcome", async () => {
    const { onFocusClose } = renderFocused({ kind: "external_beneficiary", id: "ext-1" });

    fireEvent.change(document.getElementById("ext-name")!, { target: { value: "Red Cross II" } });
    fireEvent.click(dialog("Edit Charity / External Beneficiary").getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({
        op: "edit",
        targetKind: "external_beneficiary",
        targetId: "ext-1",
        desiredFields: { name: "Red Cross II", kind: "charity", notes: null },
      }),
    ]);
  });

  it.each([
    { kind: "family_member" as const, id: "fm-child" },
    { kind: "external_beneficiary" as const, id: "ext-1" },
  ])("delete $kind removes it with a scenario change, no prompt, then closes with no outcome", async ({ kind, id }) => {
    const { onFocusClose, container } = renderFocused({ intent: "delete", kind, id });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
    expect(scenarioChangeBodies()).toEqual([{ op: "remove", targetKind: kind, targetId: id }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("delete entity removes it with a scenario change, no prompt, then closes with no outcome", async () => {
    const { onFocusClose, container } = renderFocused({ intent: "delete", kind: "entity", id: "ent-ilit" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "remove", targetKind: "entity", targetId: "ent-ilit" }),
    ]);
    // R1: inside a scenario, never a base DELETE.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("delete works for any entity type the page lists, not only trusts (Ruling P2)", async () => {
    const { onFocusClose } = renderWith(WITH_LLC, { intent: "delete", kind: "entity", id: "ent-llc" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "remove", targetKind: "entity", targetId: "ent-llc" }),
    ]);
  });

  it("delete gift removes it with a scenario change, no prompt, then closes with no outcome", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onFocusClose, container } = renderFocused({ intent: "delete", kind: "gift", id: "gift-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "remove", targetKind: "gift", targetId: "gift-1" }),
    ]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(container).toBeEmptyDOMElement();
    confirmSpy.mockRestore();
  });

  it.each([
    { kind: "entity" as const, id: "ent-ilit" },
    { kind: "gift" as const, id: "gift-1" },
    { kind: "family_member" as const, id: "fm-child" },
    { kind: "external_beneficiary" as const, id: "ext-1" },
  ])("delete $kind does not close before the write resolves", async ({ kind, id }) => {
    let release!: () => void;
    fetchMock.mockImplementation(
      (url) =>
        new Promise((resolve) => {
          const ok = { ok: true, status: 200, json: async () => (url.endsWith("/changes") ? { ok: true } : []) };
          if (url.endsWith("/changes")) release = () => resolve(ok);
          else resolve(ok);
        }),
    );
    const { onFocusClose } = renderFocused({ intent: "delete", kind, id });
    await act(async () => {});
    expect(onFocusClose).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
  });

  it.each([
    { kind: "entity" as const, id: "ent-ilit" },
    { kind: "gift" as const, id: "gift-1" },
    { kind: "family_member" as const, id: "fm-child" },
    { kind: "external_beneficiary" as const, id: "ext-1" },
  ])("delete $kind reports \"failed\" when the write fails", async ({ kind, id }) => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { onFocusClose } = renderFocused({ intent: "delete", kind, id });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("delete runs once under StrictMode", async () => {
    const onFocusClose = vi.fn();
    render(
      <StrictMode>
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <FamilyView {...PROPS} focus={{ intent: "delete", kind: "entity", id: "ent-ilit" }} onFocusClose={onFocusClose} />
        </ClientAccessProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    expect(scenarioChangeBodies()).toHaveLength(1);
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "an entity that isn't there", focus: { intent: "delete", kind: "entity", id: "gone" } as EditorFocus },
    { label: "a gift that isn't there", focus: { intent: "delete", kind: "gift", id: "gone" } as EditorFocus },
    { label: "a family member that isn't there", focus: { intent: "delete", kind: "family_member", id: "gone" } as EditorFocus },
    { label: "an external beneficiary that isn't there", focus: { intent: "delete", kind: "external_beneficiary", id: "gone" } as EditorFocus },
  ])("delete of $label → unavailable, no write", async ({ focus }) => {
    await expectUnavailable(renderFocused(focus));
    expect(scenarioChangeBodies()).toEqual([]);
  });

  it("delete of an overlay series removes it with a scenario change, no series route, then closes", async () => {
    const { onFocusClose, container } = renderFocused({ intent: "delete", kind: "gift", id: "series-ov" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({ op: "remove", targetKind: "gift", targetId: "series-ov" }),
    ]);
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("delete of a partition series → unsupported, no write", async () => {
    await expectNothingOpened(renderFocused({ intent: "delete", kind: "gift", id: "series-1" }), "unsupported");
    expect(scenarioChangeBodies()).toEqual([]);
  });
});

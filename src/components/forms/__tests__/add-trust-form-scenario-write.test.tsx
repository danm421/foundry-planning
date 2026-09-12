// @vitest-environment jsdom
//
// The trust dialog both READS and WRITES gifts, and until now both halves
// ignored the scenario the advisor was looking at.
//
// Read: the Transfers tab, the valuation-discount prefill and the CLT/CRT
// funding picker all seeded from `GET /gifts` with no `?scenario=`, so a gift
// the solver saved into a scenario was invisible here while the series list
// beside it (which already carried the scenario) showed the scenario's rows.
//
// Write: the Transfers-tab delete and the CLT/CRT funding-pick ops called the
// base gift routes directly, so a delete performed inside a scenario removed
// the gift from the BASE plan for every scenario at once.
//
// Scenario state is driven through the URL, the way `useScenarioState` really
// reads it. `use-scenario-writer` is deliberately NOT mocked — mocking it
// would leave the branch these tests exist to pin untested.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before the component import
// ---------------------------------------------------------------------------

/** `?scenario=` is the ONE thing that decides the write mode. Reassigned per
 *  test, read at call time by `useScenarioState`. */
let searchParams = new URLSearchParams("");
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/client-abc/details/family",
}));

// MilestoneYearPicker needs the milestones context — stub it to a number input.
vi.mock("@/components/milestone-year-picker", () => ({
  default: ({ value, onChange, label }: { value: number; onChange: (y: number, ref: null) => void; label: string }) => (
    <div>
      <label>{label}</label>
      <input type="number" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value), null)} />
    </div>
  ),
}));

import AddTrustForm, {
  fundingPickCreateDraft,
  fundingPickUpdateDraft,
} from "../add-trust-form";
import { assertDraftable } from "@/lib/gifts/gift-write";
import { giftRowToDraft } from "@/lib/estate/estate-flow-gifts";
import type { Entity } from "../../family-view";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "client-abc";
const TRUST_ID = "trust-xyz";
const SCENARIO_ID = "scn-1";
const ACCOUNT_ID = "acct-1";
const ASSET_GIFT_ID = "gift-asset-1";
const CASH_GIFT_ID = "gift-cash-1";
const SERIES_ID = "series-1";
const YEAR = new Date().getFullYear();

const ACCOUNTS = [
  { id: ACCOUNT_ID, name: "Family LP", value: 1_000_000, subType: "brokerage", owners: [] },
];

/** The row shape the merge really consumes — taken from the mapper itself, so a
 *  field it starts needing cannot quietly go missing from these fixtures. */
type GiftRowShape = Parameters<typeof fundingPickUpdateDraft>[0];

/** The `gifts` row shape the API actually returns (a plain `select()` row). */
function giftRow(over: Partial<GiftRowShape> = {}): GiftRowShape {
  return {
    id: ASSET_GIFT_ID,
    year: YEAR,
    amount: null,
    grantor: "client",
    recipientEntityId: TRUST_ID,
    recipientFamilyMemberId: null,
    recipientExternalBeneficiaryId: null,
    accountId: ACCOUNT_ID,
    liabilityId: null,
    businessEntityId: null,
    percent: "0.2000",
    parentGiftId: null,
    useCrummeyPowers: false,
    eventKind: "outright",
    valuationDiscount: "0.1500",
    notes: null,
    ...over,
  };
}

const CASH_GIFT_ROW = giftRow({
  id: CASH_GIFT_ID,
  accountId: null,
  percent: null,
  amount: "50000.00",
  valuationDiscount: null,
});

const SERIES_ROW = {
  id: SERIES_ID,
  grantor: "client",
  recipientEntityId: TRUST_ID,
  startYear: YEAR,
  endYear: YEAR + 4,
  annualAmount: "19000.00",
  inflationAdjust: false,
  useCrummeyPowers: true,
};

function trust(over: Partial<Entity> = {}): Entity {
  return {
    id: TRUST_ID,
    name: "Smith Family Trust",
    entityType: "trust",
    trustSubType: "irrevocable",
    isIrrevocable: true,
    grantor: "client",
    trustee: null,
    trustEnds: "survivorship",
    includeInPortfolio: false,
    isGrantor: false,
    notes: null,
    value: "0",
    basis: "0",
    owners: [],
    owner: null,
    beneficiaries: null,
    distributionMode: null,
    distributionAmount: null,
    distributionPercent: null,
    ...over,
  } as Entity;
}

const HOUSEHOLD = { client: { firstName: "Alice" }, spouse: { firstName: "Bob" } };

function props(
  activeTab: "details" | "flows" | "assets" | "transfers" | "notes" | "notes-sales",
  editing: Entity,
) {
  return {
    clientId: CLIENT_ID,
    editing,
    household: HOUSEHOLD,
    members: [],
    externals: [],
    entities: [],
    initialDesignations: [],
    activeTab,
    accounts: ACCOUNTS,
    liabilities: [],
    incomes: [],
    expenses: [],
    assetFamilyMembers: [],
    onSaved: vi.fn(),
    onClose: vi.fn(),
    onSubmitStateChange: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// fetch harness
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes every request the trust dialog makes. Order matters: the two
 *  `/gifts/...` sub-collections have to be matched before `/gifts` itself.
 *
 *  `failWrite` lets a test make ONE write route answer non-ok. Without it every
 *  non-GET answers `{ ok: true }`, and the `if (!res.ok)` guards — which are
 *  load-bearing, because `submit` RESOLVES with a failing Response instead of
 *  throwing — are never exercised. */
function installFetch(
  gifts: unknown[],
  series: unknown[] = [],
  failWrite?: (url: string, init: RequestInit) => Response | undefined,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      if (url.includes("/gifts/series")) return jsonResponse(series);
      if (url.includes("/gifts/ledger")) {
        return jsonResponse({ perGrantor: { client: { used: 0, total: 0 } }, perTrust: {} });
      }
      if (url.includes("/gifts")) return jsonResponse(gifts);
      return jsonResponse([]);
    }
    const failed = failWrite?.(url, (init ?? {}) as RequestInit);
    if (failed) return failed;
    if (url.includes("/entities/")) return jsonResponse(trust());
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchMock = ReturnType<typeof installFetch>;

const urlsOf = (m: FetchMock) => m.mock.calls.map(([u]) => String(u));
/** Every non-GET request aimed at a gift — the base gift routes or the scenario
 *  changes route. FlowsTab's `entities/:id/ensure-cash` POST fires on mount and
 *  is not a gift write, so it is deliberately excluded. */
const giftWrites = (m: FetchMock) =>
  m.mock.calls.filter(([u, init]) => {
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    const url = String(u);
    return method !== "GET" && (url.includes("/gifts") || url.includes("/changes"));
  });
const findCall = (m: FetchMock, pred: (url: string, init: RequestInit) => boolean) =>
  m.mock.calls.find(([u, init]) => pred(String(u), (init ?? {}) as RequestInit));
const bodyOf = (call: [unknown, RequestInit?] | undefined) =>
  JSON.parse(((call![1] as RequestInit).body as string) ?? "{}");

const changesUrl = `/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes`;

/** Renders a CLT with `origin: "new"` (the default), waits for the funding
 *  picker to seed from the fetched gifts, then edits a real pick. Everything
 *  in the CLT gift-ops loop sits behind `isSplitInterest && origin === "new"`,
 *  so a plain irrevocable trust would never reach it. */
async function renderCltAndOpenPicker(fetchMock: FetchMock) {
  const { container } = render(<AddTrustForm {...props("details", trust({ trustSubType: "clt" }))} />);
  await waitFor(() => expect(urlsOf(fetchMock).some((u) => u.includes("/gifts"))).toBe(true));
  // The picker trigger's summary flips from "Select assets…" to "1 row · $200K"
  // once the fetched asset gift has seeded a funding pick — proof the ops loop's
  // `update` arm has a real, existing gift to edit.
  const trigger = screen.getByLabelText("Funding-year FMV");
  await waitFor(() => expect(trigger.textContent).toMatch(/\d+ rows? ·/));
  fireEvent.click(trigger);
  return { container, trigger };
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector("form")!;
  fireEvent.submit(form);
}

// ---------------------------------------------------------------------------

describe("AddTrustForm — gift reads and writes follow the active scenario", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("");
    refreshMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Read side ───────────────────────────────────────────────────────────

  it("reads the gift list through the active scenario", async () => {
    searchParams = new URLSearchParams(`scenario=${SCENARIO_ID}`);
    const fetchMock = installFetch([giftRow()]);

    render(<AddTrustForm {...props("transfers", trust())} />);

    await waitFor(() =>
      expect(urlsOf(fetchMock)).toContain(
        `/api/clients/${CLIENT_ID}/gifts?scenario=${SCENARIO_ID}`,
      ),
    );
    // The un-scoped base URL must NOT also be fetched.
    expect(urlsOf(fetchMock)).not.toContain(`/api/clients/${CLIENT_ID}/gifts`);
  });

  it("reads the base gift list when no scenario is active", async () => {
    const fetchMock = installFetch([giftRow()]);

    render(<AddTrustForm {...props("transfers", trust())} />);

    await waitFor(() =>
      expect(urlsOf(fetchMock)).toContain(`/api/clients/${CLIENT_ID}/gifts`),
    );
    expect(urlsOf(fetchMock).some((u) => u.includes("/gifts?scenario="))).toBe(false);
  });

  // ── Transfers-tab delete ────────────────────────────────────────────────

  it("deletes a one-time transfer into the scenario, never against the base gift row", async () => {
    searchParams = new URLSearchParams(`scenario=${SCENARIO_ID}`);
    const fetchMock = installFetch([CASH_GIFT_ROW]);

    render(<AddTrustForm {...props("transfers", trust())} />);
    fireEvent.click(await screen.findByLabelText("Delete"));

    await waitFor(() => expect(giftWrites(fetchMock).length).toBe(1));
    const [url, init] = giftWrites(fetchMock)[0];
    expect(String(url)).toBe(changesUrl);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      op: "remove",
      targetKind: "gift",
      targetId: CASH_GIFT_ID,
    });
  });

  it("SCENARIO MODE: deletes a series through the series route, NOT as a change row", async () => {
    // `gift_series` carries a real `scenario_id` — it is a per-scenario row, not
    // an overlay, and this list only ever shows the active scenario's series. So
    // the direct DELETE already is the scenario-correct delete. A `gift` change
    // row would leave the series row alive: back on reload, copied into base on
    // promote, and gone from the projection, which honors the overlay.
    searchParams = new URLSearchParams(`scenario=${SCENARIO_ID}`);
    const fetchMock = installFetch([], [SERIES_ROW]);

    render(<AddTrustForm {...props("transfers", trust())} />);
    fireEvent.click(await screen.findByLabelText("Delete series"));

    await waitFor(() => expect(giftWrites(fetchMock).length).toBe(1));
    const [url, init] = giftWrites(fetchMock)[0];
    expect(String(url)).toBe(`/api/clients/${CLIENT_ID}/gifts/series/${SERIES_ID}`);
    expect((init as RequestInit).method).toBe("DELETE");
    // Zero traffic to the scenario writer — this is the whole point.
    expect(urlsOf(fetchMock).some((u) => u.includes("/changes"))).toBe(false);
    // And the row still leaves the list.
    await waitFor(() => expect(screen.queryByLabelText("Delete series")).toBeNull());
  });

  it("SCENARIO MODE: a series and a one-time gift delete take DIFFERENT paths", async () => {
    // Both rows on screen at once, deleted in turn: the series goes direct, the
    // one-time gift goes through the change writer. Pins the two branches apart
    // in one test, so collapsing them back into one path fails here.
    searchParams = new URLSearchParams(`scenario=${SCENARIO_ID}`);
    const fetchMock = installFetch([CASH_GIFT_ROW], [SERIES_ROW]);

    render(<AddTrustForm {...props("transfers", trust())} />);
    fireEvent.click(await screen.findByLabelText("Delete series"));
    await waitFor(() => expect(giftWrites(fetchMock).length).toBe(1));
    fireEvent.click(await screen.findByLabelText("Delete"));
    await waitFor(() => expect(giftWrites(fetchMock).length).toBe(2));

    const [seriesCall, giftCall] = giftWrites(fetchMock);
    expect(String(seriesCall[0])).toBe(`/api/clients/${CLIENT_ID}/gifts/series/${SERIES_ID}`);
    expect(String(giftCall[0])).toBe(changesUrl);
    expect(JSON.parse((giftCall[1] as RequestInit).body as string)).toEqual({
      op: "remove",
      targetKind: "gift",
      targetId: CASH_GIFT_ID,
    });
  });

  it("SCENARIO MODE: a rejected one-time delete surfaces the error and keeps the row", async () => {
    // `submit` RESOLVES with the failing Response rather than rejecting, so a
    // missed `.ok` check would report a save that never happened.
    searchParams = new URLSearchParams(`scenario=${SCENARIO_ID}`);
    const fetchMock = installFetch([CASH_GIFT_ROW], [], (url) =>
      url.includes("/changes") ? jsonResponse({ error: "Scenario is locked" }, 400) : undefined,
    );

    render(<AddTrustForm {...props("transfers", trust())} />);
    fireEvent.click(await screen.findByLabelText("Delete"));

    expect(await screen.findByText(/Couldn't load transfers: Scenario is locked/)).toBeInTheDocument();
    // The optimistic list filter must NOT have run — the row is still deletable.
    expect(screen.getByLabelText("Delete")).toBeInTheDocument();
    expect(giftWrites(fetchMock)).toHaveLength(1);
  });

  it("BASE MODE: deleting a one-time transfer still DELETEs the base gift route", async () => {
    const fetchMock = installFetch([CASH_GIFT_ROW]);

    render(<AddTrustForm {...props("transfers", trust())} />);
    fireEvent.click(await screen.findByLabelText("Delete"));

    await waitFor(() => expect(giftWrites(fetchMock).length).toBe(1));
    const [url, init] = giftWrites(fetchMock)[0];
    expect(String(url)).toBe(`/api/clients/${CLIENT_ID}/gifts/${CASH_GIFT_ID}`);
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("BASE MODE: deleting a series still DELETEs the base series route", async () => {
    const fetchMock = installFetch([], [SERIES_ROW]);

    render(<AddTrustForm {...props("transfers", trust())} />);
    fireEvent.click(await screen.findByLabelText("Delete series"));

    await waitFor(() => expect(giftWrites(fetchMock).length).toBe(1));
    const [url, init] = giftWrites(fetchMock)[0];
    expect(String(url)).toBe(`/api/clients/${CLIENT_ID}/gifts/series/${SERIES_ID}`);
    expect((init as RequestInit).method).toBe("DELETE");
  });

  // ── CLT funding-pick ops (base-mode regression guard) ────────────────────

  it("BASE MODE: changing a funding pick's percent still PATCHes the base gift route", async () => {
    const fetchMock = installFetch([giftRow()]);
    const { container } = await renderCltAndOpenPicker(fetchMock);

    fireEvent.change(screen.getByLabelText("Percent of Family LP"), { target: { value: "40" } });
    submitForm(container);

    await waitFor(() =>
      expect(
        findCall(fetchMock, (u, i) => u.endsWith(`/gifts/${ASSET_GIFT_ID}`) && i.method === "PATCH"),
      ).toBeDefined(),
    );
    const call = findCall(fetchMock, (u, i) => u.endsWith(`/gifts/${ASSET_GIFT_ID}`) && i.method === "PATCH");
    expect(bodyOf(call as [unknown, RequestInit])).toEqual({ percent: 0.4 });
    // Nothing may reach the scenario writer route in base mode.
    expect(urlsOf(fetchMock).some((u) => u.includes("/changes"))).toBe(false);
  });

  it("BASE MODE: adding a cash funding pick still POSTs the base gift route", async () => {
    const fetchMock = installFetch([giftRow()]);
    const { container } = await renderCltAndOpenPicker(fetchMock);

    fireEvent.click(screen.getByLabelText("Cash gift amount").previousSibling!.previousSibling as HTMLElement);
    fireEvent.change(screen.getByLabelText("Cash gift amount"), { target: { value: "25000" } });
    submitForm(container);

    await waitFor(() =>
      expect(
        findCall(fetchMock, (u, i) => u.endsWith("/gifts") && i.method === "POST"),
      ).toBeDefined(),
    );
    const call = findCall(fetchMock, (u, i) => u.endsWith("/gifts") && i.method === "POST");
    expect(bodyOf(call as [unknown, RequestInit])).toEqual({
      year: YEAR,
      grantor: "client",
      recipientEntityId: TRUST_ID,
      amount: 25000,
    });
    expect(urlsOf(fetchMock).some((u) => u.includes("/changes"))).toBe(false);
  });

  it("BASE MODE: dropping a funding pick still DELETEs the base gift route", async () => {
    // Two seeded picks: the save refuses a CLT with no funding at all, so the
    // cash gift is what is left standing after the asset row is dropped.
    const fetchMock = installFetch([giftRow(), CASH_GIFT_ROW]);
    const { container } = await renderCltAndOpenPicker(fetchMock);

    // Un-tick the asset row — the checkbox next to the percent input.
    const pct = screen.getByLabelText("Percent of Family LP");
    const row = pct.closest("label")!;
    fireEvent.click(row.querySelector('input[type="checkbox"]')!);
    submitForm(container);

    await waitFor(() =>
      expect(
        findCall(fetchMock, (u, i) => u.endsWith(`/gifts/${ASSET_GIFT_ID}`) && i.method === "DELETE"),
      ).toBeDefined(),
    );
    // The untouched cash pick must not be written at all.
    expect(giftWrites(fetchMock)).toHaveLength(1);
    expect(urlsOf(fetchMock).some((u) => u.includes("/changes"))).toBe(false);
  });

  it("BASE MODE: a rejected funding-pick write fails the save instead of reporting success", async () => {
    // The ops loop's `if (!giftRes.ok)` guards, exercised. `submit` resolves
    // with the failing Response, so an unchecked await here would close the
    // dialog on a gift write that never landed.
    const fetchMock = installFetch([giftRow()], [], (url, init) =>
      url.includes(`/gifts/${ASSET_GIFT_ID}`) && init.method === "PATCH"
        ? jsonResponse({ error: "Gift is locked" }, 400)
        : undefined,
    );
    const { container } = await renderCltAndOpenPicker(fetchMock);

    fireEvent.change(screen.getByLabelText("Percent of Family LP"), { target: { value: "40" } });
    submitForm(container);

    expect(await screen.findByText("Gift is locked")).toBeInTheDocument();
  });

  it("BASE MODE: two funding-pick ops in one save still cost exactly ONE router.refresh", async () => {
    // A refresh is a full server re-render AND it re-runs this dialog's own
    // gift/series/ledger fetches. One Save press must buy one, however many
    // gift writes it fans out into.
    const fetchMock = installFetch([giftRow()]);
    const { container } = await renderCltAndOpenPicker(fetchMock);

    fireEvent.change(screen.getByLabelText("Percent of Family LP"), { target: { value: "40" } });
    fireEvent.click(screen.getByLabelText("Cash gift amount").previousSibling!.previousSibling as HTMLElement);
    fireEvent.change(screen.getByLabelText("Cash gift amount"), { target: { value: "25000" } });
    submitForm(container);

    // Two gift ops: the percent update and the new cash pick.
    await waitFor(() => expect(giftWrites(fetchMock)).toHaveLength(2));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("SCENARIO MODE: a CLT funding-pick change is refused outright — no gift write of any kind", async () => {
    searchParams = new URLSearchParams(`scenario=${SCENARIO_ID}`);
    const fetchMock = installFetch([giftRow()]);
    const { container } = await renderCltAndOpenPicker(fetchMock);

    fireEvent.change(screen.getByLabelText("Percent of Family LP"), { target: { value: "40" } });
    submitForm(container);

    // The form's own F4 gate refuses split-interest edits inside a scenario, so
    // the ops loop is never reached. What matters here is the negative: the
    // funding change must not leak to the base gift routes.
    expect(await screen.findByText(/split-interest details can't be edited inside a scenario/i))
      .toBeInTheDocument();
    expect(giftWrites(fetchMock)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Draft builders — the merge the scenario `add` depends on
// ---------------------------------------------------------------------------

describe("funding-pick gift drafts", () => {
  it("merges a partial percent patch onto the current gift, keeping every other field", () => {
    const draft = fundingPickUpdateDraft(giftRow(), { percent: 0.4 });

    expect(draft).toEqual({
      kind: "asset-once",
      id: ASSET_GIFT_ID,
      year: YEAR,
      accountId: ACCOUNT_ID,
      percent: 0.4,
      grantor: "client",
      recipient: { kind: "entity", id: TRUST_ID },
      amountOverride: undefined,
      eventKind: "outright",
      valuationDiscount: 0.15,
    });
  });

  it("merges an amount + grantor patch onto a cash gift", () => {
    const draft = fundingPickUpdateDraft(CASH_GIFT_ROW, { amount: 25_000, grantor: "spouse" });

    expect(draft).toMatchObject({
      kind: "cash-once",
      id: CASH_GIFT_ID,
      year: YEAR,
      amount: 25_000,
      grantor: "spouse",
      crummey: false,
      recipient: { kind: "entity", id: TRUST_ID },
    });
  });

  it("keeps a non-outright eventKind — a CLT remainder gift must not become outright", () => {
    const draft = fundingPickUpdateDraft(
      giftRow({ eventKind: "clt_remainder_interest" }),
      { percent: 0.4 },
    );
    expect(draft).toMatchObject({ eventKind: "clt_remainder_interest" });
  });

  it("defaults eventKind for a scenario-added row, which comes back without the column", () => {
    // `GET /gifts?scenario=` adapts scenario-added gifts from drafts, and that
    // adapter emits no `eventKind` column.
    const draft = fundingPickUpdateDraft(giftRow({ eventKind: undefined }), { percent: 0.4 });
    expect(draft).toMatchObject({ eventKind: "outright" });
  });

  it("refuses a business-interest gift instead of letting it fall through to a base write", () => {
    const businessRow = giftRow({ accountId: null, percent: "0.1500", businessEntityId: "biz-1" });

    expect(fundingPickUpdateDraft(businessRow, { percent: 0.4 })).toBeNull();
    expect(() => assertDraftable(fundingPickUpdateDraft(businessRow, { percent: 0.4 }), "gift"))
      .toThrow(/cannot be saved into a scenario/i);
  });

  it("builds an asset draft from the differ's create body without casting it", () => {
    const draft = fundingPickCreateDraft(
      { year: YEAR, grantor: "client", recipientEntityId: TRUST_ID, accountId: ACCOUNT_ID, percent: 0.25 },
      "new-id",
    );
    expect(draft).toEqual({
      kind: "asset-once",
      id: "new-id",
      year: YEAR,
      accountId: ACCOUNT_ID,
      percent: 0.25,
      grantor: "client",
      recipient: { kind: "entity", id: TRUST_ID },
      eventKind: "outright",
    });
  });

  it("emits keys in giftRowToDraft's exact order — the JSON.stringify diff contract", () => {
    // `estate-flow-gift-diff.ts` compares gifts with JSON.stringify, which is
    // key-ORDER sensitive, so a hand-built draft whose keys are shuffled makes
    // an untouched gift show up as an unsaved edit. The reference order is
    // whatever `giftRowToDraft` emits for the equivalent row — comparing
    // against it (rather than a copied literal) means the two cannot drift.
    const keys = (g: unknown) => Object.keys(JSON.parse(JSON.stringify(g)));

    const assetRow = giftRow({ id: "new-id", percent: "0.2500", valuationDiscount: null });
    expect(
      keys(
        fundingPickCreateDraft(
          { year: YEAR, grantor: "client", recipientEntityId: TRUST_ID, accountId: ACCOUNT_ID, percent: 0.25 },
          "new-id",
        ),
      ),
    ).toEqual(keys(giftRowToDraft({ ...assetRow, eventKind: "outright" })));

    expect(
      keys(
        fundingPickCreateDraft(
          { year: YEAR, grantor: "client", recipientEntityId: TRUST_ID, amount: 25_000 },
          "new-id",
        ),
      ),
    ).toEqual(keys(giftRowToDraft({ ...CASH_GIFT_ROW, eventKind: "outright" })));
  });

  it("builds a cash draft from the differ's create body, matching the POST route's defaults", () => {
    const draft = fundingPickCreateDraft(
      { year: YEAR, grantor: "spouse", recipientEntityId: TRUST_ID, amount: 25_000 },
      "new-id",
    );
    expect(draft).toEqual({
      kind: "cash-once",
      id: "new-id",
      year: YEAR,
      amount: 25_000,
      grantor: "spouse",
      recipient: { kind: "entity", id: TRUST_ID },
      // `giftCreateSchema` defaults both of these when the body omits them.
      crummey: false,
      eventKind: "outright",
    });
  });
});

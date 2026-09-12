// @vitest-environment jsdom
//
// The three trust-transfer forms (cash, asset, recurring series) wrote gifts
// straight to the base `gifts` / `gift_series` tables even while the advisor
// was looking at a scenario, silently corrupting the base plan. All three are
// creates — see `giftScenarioAdd`'s header comment for why gifts have no
// `edit` op.
//
// Scenario state is driven through the URL, the way `useScenarioState` really
// reads it. `use-scenario-writer` is deliberately NOT mocked — mocking it
// would leave the branch these tests exist to pin untested.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before the component imports
// ---------------------------------------------------------------------------

/** `?scenario=` is the ONE thing that decides the write mode. Reassigned per
 *  render, read at call time by `useScenarioState`. */
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
  usePathname: () => "/clients/client-1/details/family",
}));

// MilestoneYearPicker needs the milestones context — stub it to a plain number
// input, same substitution used by add-trust-form-scenario-write.test.tsx.
vi.mock("@/components/milestone-year-picker", () => ({
  default: ({
    value,
    onChange,
    label,
  }: {
    value: number;
    onChange: (y: number, ref: null) => void;
    label: string;
  }) => (
    <div>
      <label>{label}</label>
      <input
        type="number"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), null)}
      />
    </div>
  ),
}));

import TransferCashForm from "../transfer-cash-form";
import TransferAssetForm, { type AccountOption } from "../transfer-asset-form";
import TransferSeriesForm from "../transfer-series-form";
import {
  giftRowToDraft,
  type GiftRow,
} from "@/lib/estate/estate-flow-gifts";

// ---------------------------------------------------------------------------
// Fixtures / render helpers
// ---------------------------------------------------------------------------

const CLIENT_ID = "client-1";
const TRUST_ID = "trust-1";
const SCENARIO_ID = "scenario-1";

const MILESTONES = {
  planStart: 2026,
  planEnd: 2075,
  clientRetirement: 2040,
  clientEnd: 2060,
};

const BASIC_ACCOUNT = { id: "acc-checking", name: "Operating Checking", isDefaultChecking: true };

const ASSET_ACCOUNT: AccountOption = {
  id: "acc-1",
  name: "Family LLC Units",
  value: 1_000_000,
  growthRate: 0.05,
  subType: "other",
  isDefaultChecking: false,
  ownerSummary: "Client 100%",
  trustPercent: 0,
  ownedByOtherEntity: false,
};

interface RenderOpts {
  scenarioId?: string | null;
  trustId?: string;
}

/** Sets the URL `?scenario=` param `useScenarioState` reads, mirroring how a
 *  form is really "in a scenario" — never via a `scenarioId` prop the
 *  component doesn't have. */
function setActiveScenario(scenarioId: string | null | undefined) {
  searchParams = scenarioId ? new URLSearchParams({ scenario: scenarioId }) : new URLSearchParams("");
}

/** Real render + real setup from transfer-cash-form.test.tsx, with the
 *  amount filled in so Save is enabled. */
function renderTransferCash({ scenarioId, trustId = TRUST_ID }: RenderOpts = {}) {
  setActiveScenario(scenarioId);
  render(
    <TransferCashForm
      clientId={CLIENT_ID}
      trustId={trustId}
      trustGrantor="client"
      accounts={[BASIC_ACCOUNT]}
      milestones={MILESTONES}
      currentYear={2026}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. 10,000/i), {
    target: { value: "18000" },
  });
}

/** Real render + real setup from transfer-asset-form.test.tsx. The default
 *  percent (50) and auto-selected eligible account are already Save-valid. */
function renderTransferAsset({ scenarioId, trustId = TRUST_ID }: RenderOpts = {}) {
  setActiveScenario(scenarioId);
  render(
    <TransferAssetForm
      trustId={trustId}
      clientId={CLIENT_ID}
      trustGrantor="client"
      accounts={[ASSET_ACCOUNT]}
      milestones={MILESTONES}
      projectionStartYear={2026}
      currentYear={2026}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

/** Real render + real setup from transfer-series-form.test.tsx, with the
 *  annual amount filled in so Save is enabled. The form's own `scenarioId`
 *  prop only shapes its base-fallback URL (ruling: write mode always comes
 *  from the hook) — passed through here so it matches the URL like a real
 *  caller (add-trust-form.tsx) does. */
function renderTransferSeries({ scenarioId, trustId = TRUST_ID }: RenderOpts = {}) {
  setActiveScenario(scenarioId);
  render(
    <TransferSeriesForm
      clientId={CLIENT_ID}
      trustId={trustId}
      trustGrantor="client"
      accounts={[BASIC_ACCOUNT]}
      milestones={MILESTONES}
      currentYear={2026}
      scenarioId={scenarioId ?? null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(/annual gift amount/i), {
    target: { value: "18000" },
  });
}

function submitForm() {
  fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transfer forms — scenario-mode gift writes", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    searchParams = new URLSearchParams("");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Full expected `entity` per form — not just a subset. This matters most
  // for the asset form, where `Number(percent) / 100` is computed twice (once
  // for the REST body, once for the draft): asserting only `kind`/`recipient`/
  // `id` would stay green even if those two copies drifted apart. `id` is the
  // one field the component mints itself (`crypto.randomUUID()`), so it's the
  // one field asserted by shape rather than value. (Important 3, task-7
  // review — the prior version of this test only checked kind/recipient/id.)
  type ScenarioWriteCase = [string, (opts: RenderOpts) => void, Record<string, unknown>];

  const SCENARIO_WRITE_CASES: ScenarioWriteCase[] = [
    [
      "cash",
      renderTransferCash,
      {
        kind: "cash-once",
        id: expect.any(String),
        year: 2026,
        amount: 18000,
        grantor: "client",
        recipient: { kind: "entity", id: TRUST_ID },
        crummey: false,
        eventKind: "outright",
      },
    ],
    [
      "asset",
      renderTransferAsset,
      {
        kind: "asset-once",
        id: expect.any(String),
        year: 2031, // default year is currentYear(2026) + 5 — see transfer-asset-form.tsx
        accountId: ASSET_ACCOUNT.id,
        percent: 0.5, // default percent input is "50"
        grantor: "client",
        recipient: { kind: "entity", id: TRUST_ID },
        eventKind: "outright",
        // no valuationDiscount key — no discount was entered (see the
        // key-order test below for the discount-present case)
      },
    ],
  ];

  it.each(SCENARIO_WRITE_CASES)(
    "%s transfer writes into the active scenario",
    async (_label, renderForm, expectedEntity) => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchMock);

      renderForm({ scenarioId: SCENARIO_ID, trustId: TRUST_ID });
      submitForm();

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes`);
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string);
      expect(body.op).toBe("add");
      expect(body.targetKind).toBe("gift");
      expect(body.entity).toEqual(expectedEntity);

      // A refresh happens once the scenario write lands — same one-refresh-per-
      // save contract as base mode (BaseFallback.skipRefresh is never set here).
      await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    },
  );

  // The series form is the exception, and it is NOT an oversight above.
  // `gift_series` carries a real `scenario_id` — it is partitioned, not
  // overlaid — so the series route IS the scenario-correct write. Recording a
  // `gift` change instead made the saved series vanish from the panel that
  // fetches it (GET /gifts/series filters the table by scenario_id and applies
  // no overlay) and made the whole scenario un-promotable
  // (`translateGiftDraftForPromote` throws for a series, inside the promote
  // transaction).
  it("series transfer writes a real gift_series row in the active scenario's partition, never a change row", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferSeries({ scenarioId: SCENARIO_ID, trustId: TRUST_ID });
    submitForm();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/clients/${CLIENT_ID}/gifts/series?scenario=${SCENARIO_ID}`,
    );
    expect(init.method).toBe("POST");

    // The REST body, byte-for-byte what the base-mode POST always sent — the
    // route, not an overlay, is what stores this row.
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      grantor: "client",
      recipientEntityId: TRUST_ID,
      startYear: 2026,
      startYearRef: null,
      endYear: 2036,
      endYearRef: null,
      annualAmount: 18000,
      inflationAdjust: false,
      useCrummeyPowers: false,
      notes: "Source: Operating Checking",
    });
    expect(body).not.toHaveProperty("op");
    expect(body).not.toHaveProperty("entity");

    // Not one request to the changes writer.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/scenarios/");
    }
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  // RULING 69. `POST /gifts` dual-writes `account_owners` when the transfer year
  // is before the plan starts, because the engine never replays an event from
  // before the projection begins. A scenario bypasses that route and the overlay
  // only emits a GiftEvent at the past year, which the engine ignores — so the
  // save succeeded and NOT ONE NUMBER MOVED. An advisor reads that as a dead
  // Save button, then re-enters the gift.
  it("refuses a past-dated asset transfer inside a scenario, by name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferAsset({ scenarioId: SCENARIO_ID, trustId: TRUST_ID });
    fireEvent.change(screen.getByLabelText(/transfer year/i), {
      target: { value: "2019" },
    });
    submitForm();

    await waitFor(() =>
      expect(screen.getByText(/before the plan starts in 2026/i)).toBeInTheDocument(),
    );
    // Refused before anything was written — no change row, no base write.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still saves the same past-dated transfer with no scenario active", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferAsset({ scenarioId: null, trustId: TRUST_ID });
    fireEvent.change(screen.getByLabelText(/transfer year/i), {
      target: { value: "2019" },
    });
    submitForm();

    // The base route CAN move the ownership, so nothing is refused there.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/clients/${CLIENT_ID}/gifts`);
    expect(JSON.parse(init.body as string).year).toBe(2019);
  });

  it.each([
    ["cash", renderTransferCash, `/api/clients/${CLIENT_ID}/gifts`],
    ["asset", renderTransferAsset, `/api/clients/${CLIENT_ID}/gifts`],
    ["series", renderTransferSeries, `/api/clients/${CLIENT_ID}/gifts/series`],
  ] as const)("%s transfer still POSTs to the base route with no scenario active", async (_label, renderForm, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderForm({ scenarioId: null, trustId: TRUST_ID });
    submitForm();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(expectedUrl);
    expect(init.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Key-order contract (estate-flow-gift-diff.ts): the unsaved-changes diff
// compares gifts with JSON.stringify, so a hand-built draft's key order must
// match `giftRowToDraft` / `giftSeriesRowToDraft`'s own output exactly, or an
// untouched gift reads as edited the next time it round-trips through a row.
// Comparing live against the real mappers (rather than a copied key list)
// means this test breaks the moment either side drifts.
// ---------------------------------------------------------------------------

/** Key order after a JSON round-trip — mirrors what the diff's
 *  `JSON.stringify` comparison actually sees (drops undefined-valued keys). */
function keysOf(value: unknown): string[] {
  return Object.keys(JSON.parse(JSON.stringify(value)));
}

describe("transfer forms — gift draft key order matches the canonical mappers", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams({ scenario: SCENARIO_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cash transfer's draft matches giftRowToDraft's cash-once key order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferCash({ scenarioId: SCENARIO_ID });
    submitForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const entity = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).entity;

    const row: GiftRow = {
      id: "row-id",
      year: 2026,
      amount: "18000",
      grantor: "client",
      recipientEntityId: TRUST_ID,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
      accountId: null,
      liabilityId: null,
      businessEntityId: null,
      percent: null,
      useCrummeyPowers: false,
      eventKind: "outright",
      valuationDiscount: null,
    };
    expect(keysOf(entity)).toEqual(keysOf(giftRowToDraft(row)));
  });

  it("asset transfer's draft matches giftRowToDraft's asset-once key order, discount included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferAsset({ scenarioId: SCENARIO_ID });
    // A discount MUST be entered here: `valuationDiscount` is undefined on an
    // empty-discount draft and null on a no-discount row, and the JSON
    // round-trip in `keysOf` drops the key from BOTH sides in that case — so
    // an empty-discount render can never exercise "valuationDiscount goes
    // LAST", the one rule this file's header comment cites. (Important 2,
    // task-7 review — confirmed this bites by temporarily reordering the
    // draft to put valuationDiscount before eventKind and watching this test
    // fail; see the FIX REPORT in task-7-report.md.)
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), {
      target: { value: "30" },
    });
    submitForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const entity = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).entity;

    // Both sides must actually carry the key, or the keysOf comparison below
    // is vacuous again.
    expect(entity).toHaveProperty("valuationDiscount");
    expect(entity.valuationDiscount).toBeCloseTo(0.3);

    const row: GiftRow = {
      id: "row-id",
      year: 2031,
      amount: null,
      grantor: "client",
      recipientEntityId: TRUST_ID,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
      accountId: ASSET_ACCOUNT.id,
      liabilityId: null,
      businessEntityId: null,
      percent: "0.5000",
      useCrummeyPowers: false,
      eventKind: "outright",
      valuationDiscount: "0.3000",
    };
    expect(keysOf(entity)).toEqual(keysOf(giftRowToDraft(row)));
  });

  // The series form has no key-order case: it builds no draft at all any more.
  // A recurring series is written straight to `gift_series` in both modes, so
  // there is no JSON.stringify-compared payload to keep in order.
});

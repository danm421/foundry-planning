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
  giftSeriesRowToDraft,
  type GiftRow,
  type GiftSeriesDbRow,
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

  it.each([
    ["cash", renderTransferCash, "cash-once"],
    ["asset", renderTransferAsset, "asset-once"],
    ["series", renderTransferSeries, "series"],
  ] as const)("%s transfer writes into the active scenario", async (_label, renderForm, expectedKind) => {
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
    expect(body.entity.kind).toBe(expectedKind);
    expect(body.entity.recipient).toEqual({ kind: "entity", id: TRUST_ID });
    expect(body.entity.id).toEqual(expect.any(String));

    // A refresh happens once the scenario write lands — same one-refresh-per-
    // save contract as base mode (BaseFallback.skipRefresh is never set here).
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
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

  it("asset transfer's draft matches giftRowToDraft's asset-once key order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferAsset({ scenarioId: SCENARIO_ID });
    submitForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const entity = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).entity;

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
      valuationDiscount: null,
    };
    expect(keysOf(entity)).toEqual(keysOf(giftRowToDraft(row)));
  });

  it("series transfer's draft matches giftSeriesRowToDraft's key order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderTransferSeries({ scenarioId: SCENARIO_ID });
    submitForm();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const entity = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).entity;

    const row: GiftSeriesDbRow = {
      id: "series-id",
      grantor: "client",
      recipientEntityId: TRUST_ID,
      startYear: 2026,
      endYear: 2036,
      annualAmount: "18000",
      amountMode: "fixed",
      inflationAdjust: false,
      useCrummeyPowers: false,
      valuationDiscount: null,
    };
    expect(keysOf(entity)).toEqual(keysOf(giftSeriesRowToDraft(row)));
  });
});

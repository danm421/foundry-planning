// @vitest-environment jsdom
//
// Saving the estate-flow (sandbox) gift edits is a WRITE, so it follows the
// active scenario like every other write on the client detail page: with
// `?scenario=` in the URL each gift change becomes a `gift` scenario_change
// row; with no scenario in the URL the legacy gift routes are called exactly
// as before.
//
// Both halves matter. The scenario half is what lets a gift name a trust that
// exists only as a scenario change (the base `gifts.recipient_entity_id`
// foreign key rejects it). The base half is the regression guard — with no
// scenario active the request must be the one advisors have been sending all
// along, same URL, same method, same body.
//
// `persistGiftChange` has FOUR request sites — series remove, series
// add/patch, one-time remove, one-time add/patch — and each is covered here in
// both modes.
//
// "Save as new scenario" is covered separately: it creates a scenario that is
// NOT yet in the URL, so it cannot use the writer hook (which closes over the
// URL's scenario). Its gift writes must land in the scenario just created, not
// in the one the advisor was previously looking at.
//
// Scenario state is driven through the URL, the way `useScenarioState` really
// reads it. `use-scenario-writer` is deliberately NOT mocked: mocking it would
// leave the branch these tests exist to pin untested.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

/** `?scenario=` decides the write mode. Reassigned per test, read at call time. */
let searchParams = new URLSearchParams("");
const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/client-1/estate-flow",
}));

// Presentation-heavy tabs the save path never touches.
vi.mock("@/components/estate-flow-chart-tab", () => ({
  EstateFlowChartTab: () => <div data-testid="chart-tab" />,
}));
vi.mock("@/components/estate-flow-comparison-tab", () => ({
  EstateFlowComparisonTab: () => <div data-testid="comparison-tab" />,
}));

// The Report tab is the sandbox's editing surface: its gift dialogs are the
// only thing that ever calls `setWorkingGifts`, and they do it through the
// three list ops below. Standing the whole dialog stack up here would test the
// dialog, not the save path — so the tab is replaced by buttons that call the
// SAME prop with the SAME real list ops, and everything downstream of it (the
// diff, the writer, the routes) stays real.
vi.mock("@/components/estate-flow-report-tab", () => ({
  EstateFlowReportTab: ({
    setWorkingGifts,
  }: {
    setWorkingGifts: React.Dispatch<React.SetStateAction<EstateFlowGift[]>>;
  }) => (
    <div>
      <button type="button" onClick={() => setWorkingGifts((cur) => updateGift(cur, EDITED_CASH_GIFT))}>
        edit cash gift
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => removeGift(cur, CASH_GIFT.id))}>
        delete cash gift
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => addGift(cur, NEW_SERIES))}>
        add series
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => removeGift(cur, SERIES_GIFT.id))}>
        delete series
      </button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import EstateFlowView from "@/components/estate-flow-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { buildClientData } from "@/engine/__tests__/fixtures";
import {
  addGift,
  updateGift,
  removeGift,
  type EstateFlowGift,
} from "@/lib/estate/estate-flow-gifts";

const CLIENT_ID = "client-1";
/** The scenario already in the URL when "Save as new scenario" is pressed. */
const OLD_SCENARIO_ID = "scn-old";
/** The scenario the POST /scenarios call mints. */
const NEW_SCENARIO_ID = "scn-new";

// Key order mirrors `giftRowToDraft` — `diffGifts` compares with
// JSON.stringify, which is key-order sensitive.
const CASH_GIFT: EstateFlowGift = {
  kind: "cash-once",
  id: "gift-1",
  year: 2027,
  amount: 50_000,
  grantor: "client",
  recipient: { kind: "family_member", id: "fm-child" },
  crummey: false,
  eventKind: "outright",
};
/** Same gift, one field moved — spread so the key order survives. */
const EDITED_CASH_GIFT: EstateFlowGift = { ...CASH_GIFT, amount: 25_000 };

const SERIES_GIFT: EstateFlowGift = {
  kind: "series",
  id: "gs-1",
  startYear: 2027,
  endYear: 2031,
  annualAmount: 19_000,
  amountMode: "fixed",
  inflationAdjust: false,
  grantor: "client",
  // An entity recipient: the series REST body maps `recipient.id` straight
  // onto `recipientEntityId` regardless of kind (pre-existing), so a
  // family-member series would bake that quirk into this assertion.
  recipient: { kind: "entity", id: "ent-trust" },
  crummey: false,
};
const NEW_SERIES: EstateFlowGift = { ...SERIES_GIFT, id: "gs-new", annualAmount: 18_000 };

/** The `gifts/series` POST body `NEW_SERIES` produces. Identical in both
 *  modes — a series always goes to the series route (only the `?scenario=`
 *  suffix on the URL differs), so one fixture pins both. */
const SERIES_REST_BODY = {
  grantor: "client",
  recipientEntityId: "ent-trust",
  startYear: 2027,
  startYearRef: null,
  endYear: 2031,
  endYearRef: null,
  annualAmount: 18_000,
  amountMode: "fixed",
  inflationAdjust: false,
  useCrummeyPowers: false,
  valuationDiscount: null,
  notes: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Every write the view made, in order. */
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

/** `scenarioId` is what the PAGE resolved server-side, NOT the write mode. */
async function renderView(scenarioId: string) {
  await act(async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <EstateFlowView
          clientId={CLIENT_ID}
          scenarioId={scenarioId}
          scenarioName="Base case"
          isMarried={false}
          ownerNames={{ clientName: "Alex", spouseName: null }}
          initialClientData={buildClientData({
            // The series recipient has to exist: the gift-tax treatment
            // resolver throws for an entity recipient with no entity context.
            entities: [
              {
                id: "ent-trust",
                name: "Family Trust",
                includeInPortfolio: false,
                isGrantor: false,
                entityType: "trust",
                isIrrevocable: true,
              },
            ],
          })}
          initialGifts={[CASH_GIFT, SERIES_GIFT]}
          cpi={0.03}
        />
      </ClientAccessProvider>,
    );
  });
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

/** The in-place save button — its label changes with the resolved scenario. */
async function saveInPlace() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save to/ }));
  });
}

describe("EstateFlowView — gift saves follow the active scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("");
    fetchMock = vi.fn(async (url: unknown) =>
      String(url).endsWith(`/clients/${CLIENT_ID}/scenarios`)
        ? { ok: true, json: async () => ({ scenario: { id: NEW_SCENARIO_ID } }) }
        : { ok: true, json: async () => ({}) },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  // ── one-time gift, add/patch site ────────────────────────────────────────
  it("writes an edited one-time gift into the scenario, not the base plan", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    await renderView("scn-1");
    await click("edit cash gift");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/scenarios/scn-1/changes`);
    expect(call.method).toBe("POST");
    const body = call.body as { op: string; targetKind: string; entity: EstateFlowGift };
    expect(body.op).toBe("add");
    expect(body.targetKind).toBe("gift");
    // Re-using the existing id is what strips the base row instead of
    // duplicating the gift.
    expect(body.entity.id).toBe("gift-1");
    expect(body.entity).toEqual(EDITED_CASH_GIFT);
    // The base `gifts` row is never touched from inside a scenario.
    expect(call.url).not.toContain(`/gifts/`);
  });

  it("still PATCHes the base gift route when no scenario is active", async () => {
    await renderView("base");
    await click("edit cash gift");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/gift-1`);
    expect(call.method).toBe("PATCH");
    expect(call.url).not.toContain("/scenarios/");
    // The flat REST body, unchanged — `accountId` is omitted on PATCH.
    expect(call.body).toEqual({
      year: 2027,
      yearRef: null,
      grantor: "client",
      recipientEntityId: null,
      recipientFamilyMemberId: "fm-child",
      recipientExternalBeneficiaryId: null,
      notes: null,
      valuationDiscount: null,
      amount: 25_000,
      useCrummeyPowers: false,
    });
  });

  // ── one-time gift, remove site ───────────────────────────────────────────
  it("removes a one-time gift as a scenario `remove` change", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    await renderView("scn-1");
    await click("delete cash gift");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/scenarios/scn-1/changes`);
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ op: "remove", targetKind: "gift", targetId: "gift-1" });
  });

  it("still DELETEs the base gift route when no scenario is active", async () => {
    await renderView("base");
    await click("delete cash gift");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/gift-1`);
    expect(call.method).toBe("DELETE");
    expect(call.body).toBeUndefined();
  });

  // ── series, add/patch site ───────────────────────────────────────────────
  //
  // A series is NEVER a `gift` change row. `gift_series` carries a real
  // `scenario_id` — partitioned, not overlaid — so the series route is the
  // scenario-correct write and the scenario rides on the URL. A change row was
  // invisible to the series GET (which filters the table and applies no
  // overlay) and made the whole scenario un-promotable.
  it("writes a new gift series into the scenario's own partition, never as a `gift` change", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    await renderView("scn-1");
    await click("add series");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/series?scenario=scn-1`);
    expect(call.method).toBe("POST");
    // The same REST body base mode sends — see the base-mode test below.
    expect(call.body).toEqual(SERIES_REST_BODY);
    for (const c of writeCalls()) {
      expect(c.url).not.toContain("/scenarios/");
    }
  });

  it("still POSTs the base series route when no scenario is active", async () => {
    await renderView("base");
    await click("add series");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/series`);
    expect(call.method).toBe("POST");
    expect(call.body).toEqual(SERIES_REST_BODY);
  });

  // ── series, remove site ──────────────────────────────────────────────────
  it("deletes a gift series through the series route, not as a `remove` change", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    await renderView("scn-1");
    await click("delete series");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    // A `remove` change would leave the `gift_series` row alive: back on
    // reload, and copied into the base plan by `copyGiftSeriesToBase` when the
    // scenario is promoted.
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/series/gs-1?scenario=scn-1`);
    expect(call.method).toBe("DELETE");
    for (const c of writeCalls()) {
      expect(c.url).not.toContain("/scenarios/");
    }
  });

  it("still DELETEs the base series route when no scenario is active", async () => {
    await renderView("base");
    await click("delete series");
    await saveInPlace();
    await waitFor(() => expect(writeCalls()).toHaveLength(1));

    const [call] = writeCalls();
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/series/gs-1`);
    expect(call.method).toBe("DELETE");
  });

  // ── "Save as new scenario" ───────────────────────────────────────────────
  it("sends a gift change to the NEWLY created scenario, not the one in the URL", async () => {
    searchParams = new URLSearchParams(`scenario=${OLD_SCENARIO_ID}`);
    await renderView(OLD_SCENARIO_ID);
    await click("edit cash gift");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as new scenario" }));
    });
    await waitFor(() => expect(writeCalls()).toHaveLength(2));

    const [create, giftCall] = writeCalls();
    expect(create.url).toBe(`/api/clients/${CLIENT_ID}/scenarios`);
    // The gift lands in the scenario that was just minted. Writing it through
    // the writer hook would send it to `scn-old` — the scenario the advisor is
    // leaving — and the new one would silently have no gifts.
    expect(giftCall.url).toBe(
      `/api/clients/${CLIENT_ID}/scenarios/${NEW_SCENARIO_ID}/changes`,
    );
    expect(giftCall.url).not.toContain(OLD_SCENARIO_ID);
    expect(giftCall.method).toBe("POST");
    const body = giftCall.body as { op: string; targetKind: string; entity: EstateFlowGift };
    expect(body.op).toBe("add");
    expect(body.targetKind).toBe("gift");
    expect(body.entity.id).toBe("gift-1");
    // Never a base gift write: the new scenario may hold a trust that the
    // base `gifts.recipient_entity_id` foreign key does not know about.
    for (const c of writeCalls()) expect(c.url).not.toContain("/gifts");
    expect(pushMock).toHaveBeenCalledWith(
      `/clients/${CLIENT_ID}/estate-flow?scenario=${NEW_SCENARIO_ID}`,
    );
  });

  it("sends a NEW series to the newly created scenario's own gift_series partition", async () => {
    searchParams = new URLSearchParams(`scenario=${OLD_SCENARIO_ID}`);
    await renderView(OLD_SCENARIO_ID);
    await click("add series");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as new scenario" }));
    });
    await waitFor(() => expect(writeCalls()).toHaveLength(2));

    const [create, seriesCall] = writeCalls();
    expect(create.url).toBe(`/api/clients/${CLIENT_ID}/scenarios`);
    // The partition is the scenario just minted — not `scn-old`, and not base.
    expect(seriesCall.url).toBe(
      `/api/clients/${CLIENT_ID}/gifts/series?scenario=${NEW_SCENARIO_ID}`,
    );
    expect(seriesCall.url).not.toContain(OLD_SCENARIO_ID);
    expect(seriesCall.method).toBe("POST");
    expect(seriesCall.body).toEqual(SERIES_REST_BODY);
    // And never a change row — `gift_series` is not an overlay kind.
    expect(seriesCall.url).not.toContain("/changes");
  });
});

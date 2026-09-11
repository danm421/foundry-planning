// @vitest-environment jsdom
//
// Details → Profile writes gifts through `useScenarioWriter` — the same hook
// accounts, incomes, expenses and liabilities already use. With `?scenario=` in
// the URL a save becomes a `scenario_changes` row; without it the legacy base
// gift routes are called exactly as before.
//
// Gifts have NO `edit` op. `partitionGiftChanges` puts EVERY targeted gift id
// into the strip set but re-materialises only `add` payloads, so an `edit` row
// would delete the gift and put nothing back. A save — a new gift or an edit of
// an existing one — is always an `add` carrying the full draft, and re-using the
// gift's id is what replaces the row rather than duplicating it.
//
// The page can also render a gift and a recipient trust that exist ONLY as
// `scenario_changes` rows (the solver's "save as scenario" never touches the
// base `entities` / `gifts` tables). Saving those through the base gift routes
// cannot work and never will: the routes validate `recipientEntityId` against
// base `entities` (400 "Recipient entity not found for this client"), the row
// lookup behind that 400 would 404, and `gifts.recipient_entity_id` carries a
// real FK to `entities(id)` that would reject the write outright.
// See `entities-and-gifts-tables-are-not-scenario-scoped`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GiftDialog from "@/components/gift-dialog";
import type {
  Gift,
  GiftSeriesLite,
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
} from "@/components/family-view";

const refreshMock = vi.fn();
/** `?scenario=s1` in the URL is the ONE thing that makes
 *  `useScenarioWriter().scenarioActive` true — the hook reads the URL, exactly
 *  as the real page does. Reassigned per test to drop into base mode. */
let searchParams = new URLSearchParams("scenario=s1");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/details/family",
}));

/** A trust the solver added to the scenario — offered by the recipient picker
 *  (which reads the effective tree) but absent from the base `entities` table. */
const SCENARIO_TRUST_ID = "375c9135-3c04-4e5c-9c1f-6a3017d39786";
/** A gift the solver added to the scenario — no row in the base `gifts` table. */
const SCENARIO_GIFT_ID = "8a17dcb2-1069-4c87-815c-327655dda5fb";
const BASE_TRUST_ID = "t1";
/** A gift that DOES have a base `gifts` row. Editing it inside a scenario must
 *  leave that row alone. */
const BASE_GIFT_ID = "9c3f21e0-5f22-4a1e-9f0b-1f1d5f4d2c77";

const baseProps = {
  clientId: "c1",
  scenarioId: "s1",
  hasSpouse: true,
  members: [] as unknown as FamilyMember[],
  externals: [] as unknown as ExternalBeneficiary[],
  entities: [
    { id: BASE_TRUST_ID, name: "ILIT", entityType: "trust", isIrrevocable: true },
    { id: SCENARIO_TRUST_ID, name: "SLAT test", entityType: "trust", isIrrevocable: true },
  ] as unknown as Entity[],
  accounts: [
    {
      id: "a1",
      name: "Family LP",
      category: "taxable",
      value: 100_000_000,
      subType: "brokerage",
      ownerFamilyMemberId: "m0",
      ownerEntityId: null,
    },
  ] as unknown as AccountLite[],
  annualExclusionByYear: { 2026: 19000 },
  planStartYear: 2026,
  onClose: vi.fn(),
  onSavedGift: vi.fn(),
  onSavedSeries: vi.fn(),
  onRemovedGift: vi.fn(),
  onRemovedSeries: vi.fn(),
};

/** The 15%-of-the-LP gift to the scenario-only SLAT, as Details → Profile
 *  renders it (draft payload mapped through `giftDraftToRow`). */
const scenarioOnlyGift: Gift = {
  id: SCENARIO_GIFT_ID,
  year: 2026,
  amount: null,
  grantor: "client",
  recipientEntityId: SCENARIO_TRUST_ID,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  accountId: "a1",
  percent: 0.15,
  valuationDiscount: 0.25,
  useCrummeyPowers: false,
  notes: null,
} as unknown as Gift;

/** A plain cash gift to a base trust, with a real row in the base `gifts` table. */
const baseGift: Gift = {
  id: BASE_GIFT_ID,
  year: 2026,
  amount: 50000,
  grantor: "client",
  recipientEntityId: BASE_TRUST_ID,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  accountId: null,
  percent: null,
  valuationDiscount: null,
  useCrummeyPowers: false,
  notes: null,
} as unknown as Gift;

/** A gift of 15% of a family LLC. No `accountId`, a `businessEntityId`, and a
 *  `percent` — a shape `EstateFlowGift` has no arm for. */
const businessGift: Gift = {
  id: "1b9b1d6e-2c0e-4a4e-9f51-0a2f3e4d5c60",
  year: 2026,
  amount: null,
  grantor: "client",
  recipientEntityId: BASE_TRUST_ID,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  accountId: null,
  percent: 0.15,
  valuationDiscount: null,
  useCrummeyPowers: false,
  eventKind: "outright",
  businessEntityId: "biz-1",
  liabilityId: null,
  notes: null,
};

/** A charitable lead trust's remainder-interest gift. Ordinary in every way
 *  except `event_kind`, which drives its transfer-tax treatment. Built off the
 *  asset gift so it carries a discount too — that proves `eventKind` is placed
 *  BEFORE `valuationDiscount`, which the JSON.stringify diff needs last. */
const cltRemainderGift: Gift = {
  ...scenarioOnlyGift,
  id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  eventKind: "clt_remainder_interest",
};

/** A recurring series living in the active scenario's `gift_series` partition. */
const BASE_SERIES_ID = "3a7c0b3e-8f2a-4a58-9f0e-1d2a3b4c5d6e";
const baseSeries: GiftSeriesLite = {
  id: BASE_SERIES_ID,
  grantor: "client",
  recipientEntityId: BASE_TRUST_ID,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: null,
  startYear: 2026,
  endYear: 2030,
  annualAmount: 19000,
  amountMode: "fixed" as const,
  inflationAdjust: false,
  valuationDiscount: null,
  useCrummeyPowers: false,
};

describe("GiftDialog — gift writes follow the active scenario", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParams = new URLSearchParams("scenario=s1");
    refreshMock.mockClear();
  });

  it("edits a solver-created gift through the scenario changes writer, not the base gift route", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={scenarioOnlyGift} />);

    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    // Regression: this used to PATCH /api/clients/c1/gifts/<id>, which 400s with
    // "Recipient entity not found for this client".
    expect(String(url)).toBe("/api/clients/c1/scenarios/s1/changes");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string);
    // An `edit` row strips the gift and re-materialises nothing.
    expect(body.op).toBe("add");
    expect(body.targetKind).toBe("gift");
    // The payload is an EstateFlowGift DRAFT, not a `gifts`-row shape, and it
    // keeps the gift's id — that is what replaces the row instead of duplicating it.
    expect(body.entity).toMatchObject({
      kind: "asset-once",
      id: SCENARIO_GIFT_ID,
      year: 2026,
      accountId: "a1",
      percent: 0.15,
      grantor: "client",
      recipient: { kind: "entity", id: SCENARIO_TRUST_ID },
    });

    // No write to the base gift routes at all.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/api/clients/c1/gifts");
    }
  });

  it("edits a base-plan gift inside a scenario as an `add` carrying its id, never an `edit`", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={baseGift} />);

    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/clients/c1/scenarios/s1/changes");
    const body = JSON.parse((init as RequestInit).body as string);
    // An `edit` row would strip the base gift and re-materialise nothing —
    // silently deleting a gift the advisor only meant to tweak in a what-if.
    expect(body.op).toBe("add");
    expect(body.entity.id).toBe(BASE_GIFT_ID);
    expect(body.entity.kind).toBe("cash-once");

    // The base `gifts` row is never touched from inside a scenario.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/api/clients/c1/gifts");
    }
  });

  it("one-time → recurring inside a scenario writes a real series row and strips the gift with a `remove` change", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "gs-new" }), { status: 201 }));
    const onRemovedGift = vi.fn();

    render(
      <GiftDialog {...baseProps} editingGift={baseGift} onRemovedGift={onRemovedGift} />,
    );
    // One-time → Recurring moves the gift between two tables that are
    // scenario-scoped in DIFFERENT ways, so the two halves land differently:
    //
    //  1. `gift_series` is partitioned, so the replacement is a REAL row in
    //     this scenario's partition — not a change row, which the series GET
    //     could not see and the promote could not carry.
    //  2. `gifts` is overlaid, so the original must be stripped with a
    //     `remove` change. A base DELETE would erase it from the base plan;
    //     doing nothing (the old behaviour) left the one-time gift beside its
    //     own recurring replacement — counted twice.
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(2));

    await waitFor(() => expect(onRemovedGift).toHaveBeenCalledWith(BASE_GIFT_ID));

    const [seriesUrl, seriesInit] = fetchMock.mock.calls[0];
    expect(String(seriesUrl)).toBe("/api/clients/c1/gifts/series?scenario=s1");
    expect((seriesInit as RequestInit).method).toBe("POST");

    const [removeUrl, removeInit] = fetchMock.mock.calls[1];
    expect(String(removeUrl)).toBe("/api/clients/c1/scenarios/s1/changes");
    expect(JSON.parse((removeInit as RequestInit).body as string)).toEqual({
      op: "remove",
      targetKind: "gift",
      targetId: BASE_GIFT_ID,
    });

    // The base `gifts` row itself is never DELETEd from inside a scenario.
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.method).not.toBe("DELETE");
    }
  });

  it("recurring → one-time inside a scenario deletes the series row it replaced", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onRemovedSeries = vi.fn();

    render(
      <GiftDialog
        {...baseProps}
        editingSeries={baseSeries}
        onRemovedSeries={onRemovedSeries}
      />,
    );
    // The other direction. The stale row is a real `gift_series` row in this
    // scenario's partition, so it has to be DELETEd — skipping it (the old
    // behaviour) orphaned the series beside its own one-time replacement, and
    // promoting the scenario copied the orphan into the base plan.
    fireEvent.click(screen.getByText("One-time"));
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(2));

    const [addUrl] = fetchMock.mock.calls[0];
    expect(String(addUrl)).toBe("/api/clients/c1/scenarios/s1/changes");

    const [delUrl, delInit] = fetchMock.mock.calls[1];
    expect(String(delUrl)).toBe(`/api/clients/c1/gifts/series/${BASE_SERIES_ID}?scenario=s1`);
    expect((delInit as RequestInit).method).toBe("DELETE");
    await waitFor(() => expect(onRemovedSeries).toHaveBeenCalledWith(BASE_SERIES_ID));
  });

  it("a shape change with no scenario active still creates the replacement then deletes the original", async () => {
    searchParams = new URLSearchParams("");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockImplementation(async (_url, init) => {
        if ((init as RequestInit | undefined)?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return new Response(
          JSON.stringify({
            id: "gs-new",
            grantor: "client",
            recipientEntityId: BASE_TRUST_ID,
            startYear: 2026,
            endYear: 2035,
            annualAmount: "50000",
            amountMode: "fixed",
            inflationAdjust: false,
            valuationDiscount: null,
            useCrummeyPowers: false,
          }),
          { status: 201 },
        );
      });

    render(<GiftDialog {...baseProps} editingGift={baseGift} />);
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(2));

    // Two requests, in this order — the writer's single base fallback covers
    // only the create.
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/clients/c1/gifts/series?scenario=s1",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `/api/clients/c1/gifts/${BASE_GIFT_ID}`,
    );
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
  });

  it("keeps `valuationDiscount` last so the draft's JSON.stringify diff stays stable", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={scenarioOnlyGift} />);
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const keys = Object.keys(body.entity);
    expect(keys[keys.length - 1]).toBe("valuationDiscount");
    expect(body.entity.valuationDiscount).toBe(0.25);
  });

  it("clearing the discount drops the key, so the replacing add row cannot keep the stale value", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={scenarioOnlyGift} />);
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // `applyEntityAdd` REPLACES the stored payload (`set: { payload: entity }`),
    // so an absent key is the whole story — there is no merge left to defend
    // against, which is why the dialog no longer sends an explicit null.
    expect(body.op).toBe("add");
    expect(body.entity).not.toHaveProperty("valuationDiscount");
  });

  it("a gift to a scenario-only trust is ADDED as a scenario change, never to the base table", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), {
      target: { value: `entity:${SCENARIO_TRUST_ID}` },
    });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), {
      target: { value: "50000" },
    });
    fireEvent.click(screen.getByText("Add gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/clients/c1/scenarios/s1/changes");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.op).toBe("add");
    expect(body.targetKind).toBe("gift");
    expect(body.entity).toMatchObject({
      kind: "cash-once",
      amount: 50000,
      recipient: { kind: "entity", id: SCENARIO_TRUST_ID },
    });
  });

  // ── gifts the draft cannot represent ─────────────────────────────────────
  //
  // `giftRowToDraft` returns null for a business-interest gift and for the
  // auto-bundled liability transfer. The dialog used to hand-roll its own
  // row→draft mapper, which could not see either column and produced
  // `{kind: "cash-once", amount: 0}` — and in a scenario the whole draft
  // REPLACES the gift, so a 15%-of-an-LLC transfer became a $0 cash gift that
  // then failed the `gifts_event_kind` check constraint on promote.
  it("refuses to save a business-interest gift instead of rewriting it as a $0 cash gift", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={businessGift} />);

    // The form never mounts — there is nothing truthful to seed it with.
    expect(screen.getByTestId("gift-uneditable")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() =>
      expect(screen.getByTestId("gift-error")).toHaveTextContent(
        /gift of a business interest/i,
      ),
    );
    // Loudly, and with NOTHING written — not a change row, not a base PATCH.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a business-interest gift in base mode too (the PATCH it used to send 400s)", async () => {
    searchParams = new URLSearchParams("");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={businessGift} />);
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(screen.getByTestId("gift-error")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the auto-bundled liability transfer rather than the business interest", async () => {
    render(
      <GiftDialog
        {...baseProps}
        editingGift={{ ...businessGift, businessEntityId: null, liabilityId: "l1" } as Gift}
      />,
    );
    expect(screen.getByTestId("gift-uneditable")).toHaveTextContent(
      /bundled liability transfer/i,
    );
  });

  // ── eventKind round trip ─────────────────────────────────────────────────
  it("keeps a CLT remainder-interest gift's eventKind through a scenario edit", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<GiftDialog {...baseProps} editingGift={cltRemainderGift} />);
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // Dropping it makes the overlay (and then the promoted base row) read
    // `outright` — a different transfer-tax treatment, silently.
    expect(body.entity.eventKind).toBe("clt_remainder_interest");
    // …and the discount stays last, the JSON.stringify diff contract.
    const keys = Object.keys(body.entity);
    expect(keys[keys.length - 1]).toBe("valuationDiscount");
  });

  // ── past-dated asset transfers ───────────────────────────────────────────
  it("refuses a past-dated asset gift inside a scenario instead of saving a no-op", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    // `planStartYear` is 2026, so 2019 is before the projection begins: the
    // gift route would move the ownership in `account_owners`, and a scenario
    // cannot — the overlay's event at a past year is simply ignored.
    render(
      <GiftDialog
        {...baseProps}
        editingGift={{ ...scenarioOnlyGift, year: 2019 } as Gift}
      />,
    );
    fireEvent.click(screen.getByText("Save gift"));

    await waitFor(() =>
      expect(screen.getByTestId("gift-error")).toHaveTextContent(
        /before the plan starts in 2026/i,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves the same past-dated asset gift on the base plan, where the ownership write works", async () => {
    searchParams = new URLSearchParams("");
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "g-new" }), { status: 201 }));

    render(
      <GiftDialog
        {...baseProps}
        editingGift={{ ...scenarioOnlyGift, year: 2019 } as Gift}
      />,
    );
    fireEvent.click(screen.getByText("Save gift"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/clients/c1/gifts");
  });

  it("leaves a base-plan gift on the base gift route with no scenario active (behavior unchanged)", async () => {
    searchParams = new URLSearchParams("");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "g-base",
          year: 2026,
          amount: "50000",
          grantor: "client",
          recipientEntityId: BASE_TRUST_ID,
          useCrummeyPowers: false,
        }),
        { status: 201 },
      ),
    );

    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), {
      target: { value: `entity:${BASE_TRUST_ID}` },
    });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), {
      target: { value: "50000" },
    });
    fireEvent.click(screen.getByText("Add gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/clients/c1/gifts");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/scenarios/");
    }
  });
});

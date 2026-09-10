// @vitest-environment jsdom
//
// Details → Profile can render a gift and a recipient trust that exist ONLY as
// `scenario_changes` rows (the solver's "save as scenario" never touches the
// base `entities` / `gifts` tables). Saving such a gift through the base gift
// routes cannot work and never will: the routes validate `recipientEntityId`
// against base `entities` (400 "Recipient entity not found for this client"),
// the row lookup behind that 400 would 404, and `gifts.recipient_entity_id`
// carries a real FK to `entities(id)` that would reject the write outright.
//
// So a scenario-only gift has to be written through the sanctioned scenario
// changes writer instead. See `entities-and-gifts-tables-are-not-scenario-scoped`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GiftDialog from "@/components/gift-dialog";
import type {
  Gift,
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
} from "@/components/family-view";

/** A trust the solver added to the scenario — offered by the recipient picker
 *  (which reads the effective tree) but absent from the base `entities` table. */
const SCENARIO_TRUST_ID = "375c9135-3c04-4e5c-9c1f-6a3017d39786";
/** A gift the solver added to the scenario — no row in the base `gifts` table. */
const SCENARIO_GIFT_ID = "8a17dcb2-1069-4c87-815c-327655dda5fb";
const BASE_TRUST_ID = "t1";

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

describe("GiftDialog — gifts that exist only in the scenario", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("edits a solver-created gift through the scenario changes writer, not the base gift route", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <GiftDialog
        {...baseProps}
        editingGift={scenarioOnlyGift}
        scenarioOnly={{ giftIds: [SCENARIO_GIFT_ID], entityIds: [SCENARIO_TRUST_ID] }}
      />,
    );

    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    // Regression: this used to PATCH /api/clients/c1/gifts/<id>, which 400s with
    // "Recipient entity not found for this client".
    expect(String(url)).toBe("/api/clients/c1/scenarios/s1/changes");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.op).toBe("edit");
    expect(body.targetKind).toBe("gift");
    expect(body.targetId).toBe(SCENARIO_GIFT_ID);
    // The payload is an EstateFlowGift DRAFT, not a `gifts`-row shape.
    expect(body.desiredFields).toMatchObject({
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

  it("keeps `valuationDiscount` last so the draft's JSON.stringify diff stays stable", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <GiftDialog
        {...baseProps}
        editingGift={scenarioOnlyGift}
        scenarioOnly={{ giftIds: [SCENARIO_GIFT_ID], entityIds: [SCENARIO_TRUST_ID] }}
      />,
    );
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const keys = Object.keys(body.desiredFields);
    expect(keys[keys.length - 1]).toBe("valuationDiscount");
    expect(body.desiredFields.valuationDiscount).toBe(0.25);
  });

  it("clearing the discount sends an explicit null, so the merge into the add row overwrites it", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <GiftDialog
        {...baseProps}
        editingGift={scenarioOnlyGift}
        scenarioOnly={{ giftIds: [SCENARIO_GIFT_ID], entityIds: [SCENARIO_TRUST_ID] }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Valuation discount/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // `undefined` would let the spread in applyEntityEdit keep the stale 0.25.
    expect(body.desiredFields.valuationDiscount).toBeNull();
  });

  it("a gift to a scenario-only trust is ADDED as a scenario change, never to the base table", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(
      <GiftDialog
        {...baseProps}
        scenarioOnly={{ giftIds: [], entityIds: [SCENARIO_TRUST_ID] }}
      />,
    );
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

  it("leaves a base-plan gift to a base trust on the base gift route (behavior unchanged)", async () => {
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

    render(
      <GiftDialog
        {...baseProps}
        scenarioOnly={{ giftIds: [SCENARIO_GIFT_ID], entityIds: [SCENARIO_TRUST_ID] }}
      />,
    );
    fireEvent.change(screen.getByTestId("recipient"), {
      target: { value: `entity:${BASE_TRUST_ID}` },
    });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), {
      target: { value: "50000" },
    });
    fireEvent.click(screen.getByText("Add gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/clients/c1/gifts");
  });
});

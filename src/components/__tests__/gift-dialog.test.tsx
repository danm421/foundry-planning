// @vitest-environment jsdom
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

// GiftDialog writes through `useScenarioWriter`, which reads `?scenario=` from
// the URL. No scenario param here, so every save below stays in BASE mode and
// pins the legacy gift routes exactly as before.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/details/family",
}));

const baseProps = {
  clientId: "c1",
  scenarioId: "s1",
  hasSpouse: true,
  members: [{ id: "m1", firstName: "Jane", lastName: "Doe", role: "child", relationship: "child", dateOfBirth: null, notes: null, domesticPartner: false, inheritanceClassOverride: {} }] as unknown as FamilyMember[],
  externals: [{ id: "x1", name: "Red Cross", kind: "charity", notes: null }] as unknown as ExternalBeneficiary[],
  entities: [{ id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true }] as unknown as Entity[],
  accounts: [{ id: "a1", name: "Brokerage", category: "taxable", value: 500_000, subType: "brokerage", ownerFamilyMemberId: "m0", ownerEntityId: null }] as unknown as AccountLite[],
  annualExclusionByYear: { 2026: 19000 },
  planStartYear: 2026,
  onClose: vi.fn(),
  onSavedGift: vi.fn(),
  onSavedSeries: vi.fn(),
  onRemovedGift: vi.fn(),
  onRemovedSeries: vi.fn(),
};

describe("GiftDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hides the split option when there is no spouse", () => {
    render(<GiftDialog {...baseProps} hasSpouse={false} />);
    const grantor = screen.getByTestId("grantor") as HTMLSelectElement;
    expect([...grantor.options].map((o) => o.value)).not.toContain("joint");
  });

  it("offers the valuation-discount field now that this surface round-trips one", () => {
    // Was suppressed while AccountLite carried no value/subType and
    // toEditingDraft could not read a saved discount. Both are wired now, so
    // the field is offered on the shapes where a discount is plausible.
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    expect(screen.getByLabelText(/Valuation discount/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Recurring"));
    expect(screen.getByLabelText(/Valuation discount/i)).toBeTruthy();
  });

  it("still hides the field on a one-time cash gift to an individual (approved gate)", () => {
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
  });

  it("all recipients remain selectable when Recurring is selected (trust gate lifted)", () => {
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Recurring"));
    const recipient = screen.getByTestId("recipient") as HTMLSelectElement;
    const values = [...recipient.options].map((o) => o.value);
    expect(values).toContain("entity:t1");
    expect(values).toContain("family_member:m1");
    expect(values).toContain("external_beneficiary:x1");
  });

  it("maps the encoded recipient value to the correct FK on a cash POST", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "g1", year: 2026, amount: "1000", grantor: "client", recipientFamilyMemberId: "m1", useCrummeyPowers: false }), { status: 201 }),
    );
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "1000" } });
    fireEvent.click(screen.getByText("Add gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.recipientFamilyMemberId).toBe("m1");
    expect(body.recipientEntityId).toBeUndefined();
  });

  it("keeps Frequency editable after the form becomes a valid draft (no kind lock on add)", () => {
    // Regression: the dialog fed its live `draft` back as the form's `editing`
    // seed, so the first valid draft flipped kindLocked=true and froze the
    // Frequency/Funding toggles mid-entry.
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "1000" } });
    // Draft is now valid (recipient + positive amount). Recurring must stay live.
    const recurring = screen.getByText("Recurring").closest("button")!;
    expect(recurring).not.toBeDisabled();
    fireEvent.click(recurring);
    expect(screen.getByText("Start year")).toBeInTheDocument();
    expect(screen.getByText("End year")).toBeInTheDocument();
  });

  it("formats the typed dollar amount with thousands separators and a $ prefix", () => {
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    const amount = screen.getByLabelText(/amount/i, { selector: "input" }) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "75000" } });
    expect(amount.value).toBe("75,000");
  });

  it("posts a series with amountMode=annual_exclusion to the series route with the scenario param", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "se1", grantor: "joint", recipientEntityId: "t1", startYear: 2026, endYear: 2035, annualAmount: "38000", amountMode: "annual_exclusion", inflationAdjust: false, useCrummeyPowers: true }), { status: 201 }),
    );
    render(<GiftDialog {...baseProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.change(screen.getByTestId("grantor"), { target: { value: "joint" } });
    fireEvent.click(screen.getByText("Max annual exclusion"));
    fireEvent.click(screen.getByText("Add gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/gifts/series?scenario=s1");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.amountMode).toBe("annual_exclusion");
    expect(body.annualAmount).toBe(38000); // 19000 × 2
  });
});

// ── Editing a saved gift ─────────────────────────────────────────────────────
// A saved gift is fully editable, including the two toggles that decide its
// shape. Frequency crosses tables and Funding rewrites `accountId`, which the
// PATCH schema refuses — so those saves create the replacement and delete the
// original instead of updating in place.

const savedCashGift: Gift = {
  id: "g1",
  year: 2026,
  amount: 25000,
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: "m1",
  recipientExternalBeneficiaryId: null,
  accountId: null,
  percent: null,
  valuationDiscount: null,
  useCrummeyPowers: false,
  notes: null,
};

/** Queue one response per fetch call, in order. */
function mockFetchSequence(...bodies: unknown[]) {
  const mock = vi.spyOn(global, "fetch");
  for (const b of bodies) {
    mock.mockResolvedValueOnce(new Response(JSON.stringify(b), { status: 200 }));
  }
  return mock;
}

describe("GiftDialog — editing a saved gift", () => {
  // clearAllMocks too: restoreAllMocks only unwinds spies, so the shared
  // baseProps callbacks would carry their calls across tests.
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("leaves Frequency and Funding editable", () => {
    render(<GiftDialog {...baseProps} editingGift={savedCashGift} />);
    expect(screen.getByText("Recurring").closest("button")).not.toBeDisabled();
    expect(screen.getByText("Specific asset").closest("button")).not.toBeDisabled();
  });

  it("PATCHes in place when the shape did not change", async () => {
    const fetchMock = mockFetchSequence({ ...savedCashGift, amount: "30000" });
    render(<GiftDialog {...baseProps} editingGift={savedCashGift} />);
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), {
      target: { value: "30000" },
    });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/clients/c1/gifts/g1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(baseProps.onRemovedGift).not.toHaveBeenCalled();
  });

  it("moves a one-time gift to the series table when Frequency flips", async () => {
    const fetchMock = mockFetchSequence(
      { id: "se9", grantor: "client", recipientFamilyMemberId: "m1", startYear: 2026, endYear: 2035, annualAmount: "25000", amountMode: "fixed", inflationAdjust: false, useCrummeyPowers: false },
      { ok: true },
    );
    render(<GiftDialog {...baseProps} editingGift={savedCashGift} />);
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(String(createUrl)).toBe("/api/clients/c1/gifts/series?scenario=s1");
    expect((createInit as RequestInit).method).toBe("POST");
    // The one-time amount carries over, so Save is never dead on a $0 draft.
    expect(JSON.parse((createInit as RequestInit).body as string).annualAmount).toBe(25000);

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1];
    expect(String(deleteUrl)).toBe("/api/clients/c1/gifts/g1");
    expect((deleteInit as RequestInit).method).toBe("DELETE");
    expect(baseProps.onRemovedGift).toHaveBeenCalledWith("g1");
    expect(baseProps.onSavedSeries).toHaveBeenCalled();
  });

  it("carries the saved year into the series, so the flip is valid on arrival", async () => {
    const fetchMock = mockFetchSequence({ id: "se9" }, { ok: true });
    render(<GiftDialog {...baseProps} editingGift={{ ...savedCashGift, year: 2040 }} />);
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.startYear).toBe(2040);
    // A default end year behind the start year would be an invalid series.
    expect(body.endYear).toBeGreaterThanOrEqual(2040);
  });

  it("re-creates the row when Funding flips to a specific asset", async () => {
    const fetchMock = mockFetchSequence(
      { id: "g9", year: 2026, grantor: "client", recipientFamilyMemberId: "m1", accountId: "a1", percent: "1", useCrummeyPowers: false },
      { ok: true },
    );
    render(<GiftDialog {...baseProps} editingGift={savedCashGift} />);
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByTestId("account"), { target: { value: "a1" } });
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(String(createUrl)).toBe("/api/clients/c1/gifts");
    expect((createInit as RequestInit).method).toBe("POST");
    const body = JSON.parse((createInit as RequestInit).body as string);
    expect(body.accountId).toBe("a1");
    expect(body.percent).toBe(1);

    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/clients/c1/gifts/g1");
    expect(baseProps.onRemovedGift).toHaveBeenCalledWith("g1");
  });

  it("drops a saved discount when the replacement shape cannot carry one", async () => {
    // Superseded expectation: this used to copy the discount across, because the
    // dialog never rendered the field and a re-create would otherwise re-file
    // the gift at full value. The field is rendered now, and flipping to CASH
    // for an individual visibly removes it — there is nothing to appraise. So
    // the replacement must not inherit 30%; keeping it would discount a cash
    // gift with no field anywhere in the app to show it, and under-report the
    // exemption the gift consumes. A flip that KEEPS the field (asset -> asset,
    // one-time -> recurring) still carries the value via the seeded draft — see
    // gift-dialog-valuation-discount.test.tsx.
    const fetchMock = mockFetchSequence({ id: "g9" }, { ok: true });
    render(
      <GiftDialog
        {...baseProps}
        editingGift={{ ...savedCashGift, accountId: "a1", amount: null, percent: 0.5, valuationDiscount: 0.3 }}
      />,
    );
    fireEvent.click(screen.getByText("Cash"));
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), {
      target: { value: "25000" },
    });
    expect(screen.queryByLabelText(/Valuation discount/i)).toBeNull();
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.valuationDiscount).toBeNull();
  });

  it("keeps the replacement and reports the failure when the old row will not delete", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "g9" }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    render(<GiftDialog {...baseProps} editingGift={savedCashGift} />);
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("Save gift"));
    await waitFor(() => expect(screen.getByTestId("gift-error")).toBeInTheDocument());
    expect(screen.getByTestId("gift-error").textContent).toMatch(/could not be removed/i);
    expect(baseProps.onRemovedGift).not.toHaveBeenCalled();
  });
});

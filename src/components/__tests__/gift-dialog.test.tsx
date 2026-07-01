// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GiftDialog from "@/components/gift-dialog";
import type {
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
} from "@/components/family-view";

const baseProps = {
  clientId: "c1",
  scenarioId: "s1",
  hasSpouse: true,
  members: [{ id: "m1", firstName: "Jane", lastName: "Doe", role: "child", relationship: "child", dateOfBirth: null, notes: null, domesticPartner: false, inheritanceClassOverride: {} }] as unknown as FamilyMember[],
  externals: [{ id: "x1", name: "Red Cross", kind: "charity", notes: null }] as unknown as ExternalBeneficiary[],
  entities: [{ id: "t1", name: "ILIT", entityType: "trust", isIrrevocable: true }] as unknown as Entity[],
  accounts: [{ id: "a1", name: "Brokerage", category: "taxable", ownerFamilyMemberId: "m0", ownerEntityId: null }] as unknown as AccountLite[],
  annualExclusionByYear: { 2026: 19000 },
  onClose: vi.fn(),
  onSavedGift: vi.fn(),
  onSavedSeries: vi.fn(),
};

describe("GiftDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hides the split option when there is no spouse", () => {
    render(<GiftDialog {...baseProps} hasSpouse={false} />);
    const grantor = screen.getByTestId("grantor") as HTMLSelectElement;
    expect([...grantor.options].map((o) => o.value)).not.toContain("joint");
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

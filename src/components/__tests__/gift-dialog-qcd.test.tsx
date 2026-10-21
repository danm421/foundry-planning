// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GiftDialog from "@/components/gift-dialog";
import type { FamilyMember, ExternalBeneficiary, AccountLite, Gift } from "@/components/family-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/details/family",
}));

const principals = [
  { id: "p1", firstName: "Jane", lastName: "Doe", role: "client", relationship: "other", dateOfBirth: "1953-03-10", notes: null },
] as unknown as FamilyMember[];
const ira = (over: Partial<AccountLite> = {}) =>
  ({
    id: "ira1", name: "Jane IRA", category: "retirement", value: 400_000, subType: "traditional_ira",
    ownerFamilyMemberId: "p1", ownerEntityId: null, ...over,
  }) as AccountLite;

const props = (over: Record<string, unknown> = {}) => ({
  clientId: "c1", scenarioId: "s1", hasSpouse: false, members: [] as FamilyMember[], principals,
  externals: [
    { id: "pub", name: "Red Cross", kind: "charity", charityType: "public", notes: null },
    { id: "priv", name: "Foundation", kind: "charity", charityType: "private", notes: null },
  ] as ExternalBeneficiary[],
  entities: [], accounts: [ira()], annualExclusionByYear: { 2026: 19_000 }, planStartYear: 2026,
  onClose: vi.fn(), onSavedGift: vi.fn(), onSavedSeries: vi.fn(), onRemovedGift: vi.fn(), onRemovedSeries: vi.fn(),
  ...over,
});

describe("GiftDialog — From an IRA", () => {
  it("offers the IRA owned by a principal when the recipient is a public charity", () => {
    render(<GiftDialog {...props()} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:pub" } });
    fireEvent.click(screen.getByText("From an IRA"));
    const opts = [...(screen.getByTestId("qcd-account") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toContain("Jane IRA (Jane)");
  });

  it("never offers it for a person, though every person's row carries charity type public", () => {
    const clara = { id: "ind", name: "Clara Reyes", kind: "individual", charityType: "public", notes: null } as ExternalBeneficiary;
    render(<GiftDialog {...props({ externals: [clara, ...props().externals] })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:ind" } });
    expect(screen.queryByText("From an IRA")).toBeNull();
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:pub" } });
    expect(screen.getByText("From an IRA")).toBeInTheDocument();
  });

  it("says private charities can't take a QCD", () => {
    render(<GiftDialog {...props()} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:priv" } });
    expect(screen.getByText("QCDs can only go to public charities.")).toBeInTheDocument();
  });

  it("offers nothing when no principal's IRA qualifies", () => {
    render(<GiftDialog {...props({ accounts: [ira({ subType: "roth_ira" })] })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:pub" } });
    expect(screen.queryByText("From an IRA")).toBeNull();
  });

  /** Public charity → From an IRA → Jane IRA → Fixed amount. */
  function fixedQcd() {
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:pub" } });
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Fixed amount"));
  }

  it("compares a later year's gift with the cap grown at the plan's tax inflation rate", () => {
    render(<GiftDialog {...props({ taxInflationRate: 0.025 })} />);
    fixedQcd();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2030" } });
    // 111,000 × 1.025⁴ = 122,523 → $122,000. Under it: no warning, though it is
    // over the flat 2026 figure.
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "115000" } });
    expect(screen.queryByText(/QCD limit/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "130000" } });
    expect(
      screen.getByText("Above the 2030 QCD limit of $122,000. The extra is taxed, then deducted as a normal gift."),
    ).toBeInTheDocument();
  });

  it("skips the RMD-start note for an inherited IRA", () => {
    // Jane, born 1953, has RMDs from 2026.
    const fullRmdIn2025 = () => {
      fireEvent.change(screen.getByTestId("recipient"), { target: { value: "external_beneficiary:pub" } });
      fireEvent.click(screen.getByText("From an IRA"));
      fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
      fireEvent.click(screen.getByText("Full RMD"));
      fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2025" } });
    };
    const { unmount } = render(<GiftDialog {...props()} />);
    fullRmdIn2025();
    expect(screen.getByText("Jane's RMDs start in 2026; a Full RMD QCD gives nothing before then.")).toBeInTheDocument();
    unmount();

    render(<GiftDialog {...props({ accounts: [ira({ inherited: true })] })} />);
    fullRmdIn2025();
    expect(screen.queryByText(/RMDs start in/)).toBeNull();
  });

  it("refuses to save a QCD whose IRA can't fund one any more, naming why — never as a cash gift", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const editingGift = {
      id: "g1", year: 2027, amount: 5_000, grantor: "client", recipientEntityId: null,
      recipientFamilyMemberId: null, recipientExternalBeneficiaryId: "pub", accountId: null, percent: null,
      valuationDiscount: null, useCrummeyPowers: false, eventKind: "outright", businessEntityId: null,
      liabilityId: null, qcdAccountId: "ira1", qcdAmountMode: "fixed", notes: null,
    } as Gift;
    // Jane's date of birth is gone, so Jane IRA can't fund a QCD.
    const noDob = [{ ...principals[0], dateOfBirth: null }] as FamilyMember[];
    render(<GiftDialog {...props({ editingGift, principals: noDob })} />);
    const reason =
      "Jane has no date of birth on file, so Jane IRA can't fund a QCD. Switch Funding to Cash.";
    expect(screen.getByTestId("qcd-unavailable")).toHaveTextContent(reason);
    await act(async () => {
      fireEvent.click(screen.getByText("Save gift"));
    });
    expect(screen.getByTestId("gift-error")).toHaveTextContent(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftDialog from "@/components/gift-dialog";
import type { FamilyMember, ExternalBeneficiary, AccountLite } from "@/components/family-view";

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
});

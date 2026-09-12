// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftForm, { type GiftFormProps } from "@/components/gift-form";
import GiftDialog from "@/components/gift-dialog";
import type {
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

// A household holding a $0 cash account alongside a valuable one — the exact
// prod shape that made "Add gift" refuse in silence: the advisor picked the
// $0 account, typed $15m, and got "Please complete the gift before saving."
// with nothing on screen worth $0 and no field named.
const base = (over: Partial<GiftFormProps> = {}): GiftFormProps => ({
  recipients: {
    trusts: [{ id: "t1", name: "New Trust" }],
    familyMembers: [{ id: "m1", firstName: "Jane", lastName: "Doe" }],
    externals: [],
  },
  accounts: [
    { id: "cash", name: "Whatnot — Cash", value: 0, subType: "checking" },
    { id: "corp", name: "Whatnot", value: 100_000_000, subType: "c_corp" },
  ],
  hasSpouse: false,
  annualExclusionByYear: { 2026: 19_000 },
  editing: null,
  onChange: vi.fn(),
  ...over,
});

const lastReason = (onChange: ReturnType<typeof vi.fn>) => {
  const calls = onChange.mock.calls;
  return calls.length ? (calls[calls.length - 1][1] as string | null) : null;
};

/** Trust recipient + in-kind funding from the named account. */
function assetGiftFrom(accountId: string) {
  fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
  fireEvent.click(screen.getByText("Specific asset"));
  fireEvent.change(screen.getByTestId("account"), { target: { value: accountId } });
}

describe("GiftForm — an asset worth $0", () => {
  it("still previews the value, so $0 reads as $0 rather than as a blank space", () => {
    render(<GiftForm {...base()} />);
    assetGiftFrom("cash");

    expect(
      (screen.getByTestId("asset-value-preview").textContent ?? "").replace(/\s+/g, " ").trim(),
      // 100% is the form's default share — the point of the assertion is the
      // "$0", which used to be withheld entirely.
    ).toBe("Current value $0 · gifting 100% ≈ $0");
  });

  it("names the $0 asset as the reason a dollar-sized gift cannot be saved", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftFrom("cash");
    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "15000000" } });

    expect(lastReason(onChange)).toBe(
      '"Whatnot — Cash" is worth $0, so no share of it can be gifted. Pick a different asset, or give the account a value first.',
    );
  });

  it("reports no reason once the same gift is sourced from an asset with value", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftFrom("corp");
    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "15000000" } });

    expect(lastReason(onChange)).toBeNull();
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toMatchObject({
      kind: "asset-once",
      accountId: "corp",
      percent: 0.15,
    });
  });
});

describe("GiftForm — every other way the draft can be incomplete names its field", () => {
  it("asks for a recipient before anything else", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    expect(lastReason(onChange)).toBe("Choose who receives the gift.");
  });

  it("asks for the asset when in-kind funding has none selected", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    expect(lastReason(onChange)).toBe("Choose the asset to give.");
  });

  it("asks for a percentage when the share is left at nothing", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftFrom("corp");
    fireEvent.change(screen.getByTestId("asset-percent"), { target: { value: "0" } });
    expect(lastReason(onChange)).toBe("Enter the percentage of the asset to give.");
  });

  it("asks for a dollar amount on a cash gift", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    expect(lastReason(onChange)).toBe("Enter an amount to give.");
  });

  it("asks for a yearly amount on a recurring gift", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "family_member:m1" } });
    fireEvent.click(screen.getByText("Recurring"));
    expect(lastReason(onChange)).toBe("Enter an amount to give each year.");
  });
});

const dialogProps = {
  clientId: "c1",
  scenarioId: "s1",
  hasSpouse: false,
  members: [] as unknown as FamilyMember[],
  externals: [] as unknown as ExternalBeneficiary[],
  entities: [{ id: "t1", name: "New Trust", entityType: "trust", isIrrevocable: true }] as unknown as Entity[],
  accounts: [
    { id: "cash", name: "Whatnot — Cash", category: "taxable", value: 0, subType: "checking", ownerFamilyMemberId: "m0", ownerEntityId: null },
  ] as unknown as AccountLite[],
  annualExclusionByYear: { 2026: 19_000 },
  planStartYear: 2026,
  onClose: vi.fn(),
  onSavedGift: vi.fn(),
  onSavedSeries: vi.fn(),
  onRemovedGift: vi.fn(),
  onRemovedSeries: vi.fn(),
};

describe("GiftDialog — refusing to save says which field is at fault", () => {
  it("replaces the generic message with the reason the form reported", () => {
    render(<GiftDialog {...dialogProps} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByTestId("account"), { target: { value: "cash" } });
    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "15000000" } });
    fireEvent.click(screen.getByText("Add gift"));

    expect(screen.getByTestId("gift-error").textContent).toBe(
      '"Whatnot — Cash" is worth $0, so no share of it can be gifted. Pick a different asset, or give the account a value first.',
    );
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftForm, { type GiftFormProps } from "@/components/gift-form";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

// $1,000,000 today; the projection grows it to $2,000,000 by 2030. The two
// numbers are deliberately far apart: a form that sizes a 2030 gift off today's
// balance lands on double the intended share, and every assertion below is
// written to catch exactly that.
const TODAY_VALUE = 1_000_000;
const VALUE_2030 = 2_000_000;

const base = (over: Partial<GiftFormProps> = {}): GiftFormProps => ({
  recipients: {
    trusts: [{ id: "t1", name: "ILIT" }],
    familyMembers: [{ id: "m1", firstName: "Jane", lastName: "Doe" }],
    externals: [],
  },
  accounts: [{ id: "a1", name: "Brokerage", value: TODAY_VALUE, subType: "brokerage" }],
  hasSpouse: false,
  annualExclusionByYear: { 2026: 19_000 },
  editing: null,
  accountValueAtYear: (accountId, year) =>
    accountId === "a1" && year === 2030 ? VALUE_2030 : undefined,
  onChange: vi.fn(),
  ...over,
});

function lastDraft(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as EstateFlowGift | null) : null;
}

/** Pick a trust recipient, switch to in-kind funding, choose the account and
 *  move the gift to 2030 — the shared starting point for every case below. */
function assetGiftIn2030() {
  fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
  fireEvent.click(screen.getByText("Specific asset"));
  fireEvent.change(screen.getByTestId("account"), { target: { value: "a1" } });
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: "2030" } });
}

const previewText = () =>
  (screen.getByTestId("asset-value-preview").textContent ?? "").replace(/\s+/g, " ").trim();

describe("GiftForm — sizing an asset gift in dollars", () => {
  it("converts a dollar amount to the share worth that much in the GIFT year", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftIn2030();

    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "500000" } });

    // $500k of the 2030 value ($2m) is 25%. Off today's $1m it would be 50% —
    // the error this whole surface exists to prevent.
    expect(lastDraft(onChange)).toMatchObject({
      kind: "asset-once",
      year: 2030,
      accountId: "a1",
      percent: 0.25,
    });
  });

  it("previews the projected gift-year value, the share and the resulting dollars", () => {
    render(<GiftForm {...base()} />);
    assetGiftIn2030();
    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "500000" } });

    // Asserted exactly, not by substring: "$2,000,000" contains "$2,000" and
    // "0.25%" contains "25%", so a toContain here would survive both the
    // fraction-vs-percent and the x1000 scale errors.
    expect(previewText()).toBe("Projected value in 2030 $2,000,000 · gifting 25% ≈ $500,000");
  });

  it("falls back to the account's current value — and says so — with no projection", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange, accountValueAtYear: undefined })} />);
    assetGiftIn2030();
    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "500000" } });

    expect(previewText()).toBe("Current value $1,000,000 · gifting 50% ≈ $500,000");
    expect(lastDraft(onChange)).toMatchObject({ percent: 0.5 });
    // The label alone is too quiet for this: sized off today's balance, the
    // share is worth something quite different in 2030. Say it outright.
    expect(screen.getByTestId("asset-value-not-projected")).toBeTruthy();
  });

  it("does not cry stale when the projection actually answers for the gift year", () => {
    render(<GiftForm {...base()} />);
    assetGiftIn2030();
    expect(screen.queryByTestId("asset-value-not-projected")).toBeNull();
  });

  it("does not cry stale for a gift dated this year, where today's value IS the value", () => {
    render(<GiftForm {...base({ accountValueAtYear: undefined })} />);
    fireEvent.change(screen.getByTestId("recipient"), { target: { value: "entity:t1" } });
    fireEvent.click(screen.getByText("Specific asset"));
    fireEvent.change(screen.getByTestId("account"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/^year$/i), {
      target: { value: String(new Date().getFullYear()) },
    });
    expect(screen.queryByTestId("asset-value-not-projected")).toBeNull();
  });

  it("keeps the gift the same size when the advisor flips percent → dollars and back", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftIn2030();
    fireEvent.change(screen.getByTestId("asset-percent"), { target: { value: "40" } });
    expect(lastDraft(onChange)).toMatchObject({ percent: 0.4 });

    fireEvent.click(screen.getByText("Dollar amount"));
    expect((screen.getByTestId("asset-dollars") as HTMLInputElement).value).toBe("800,000");
    expect(lastDraft(onChange)).toMatchObject({ percent: 0.4 });

    fireEvent.click(screen.getByText("Percent"));
    expect(lastDraft(onChange)).toMatchObject({ percent: 0.4 });
  });

  it("caps a dollar amount larger than the asset at the whole asset", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftIn2030();
    fireEvent.click(screen.getByText("Dollar amount"));
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "9000000" } });

    expect(lastDraft(onChange)).toMatchObject({ percent: 1 });
    expect(screen.getByTestId("asset-dollars-capped")).toBeTruthy();
  });

  it("blocks a save — with a reason — when the amount rounds away to no share at all", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    assetGiftIn2030();
    fireEvent.click(screen.getByText("Dollar amount"));
    // $50 of $2m is 0.0025%, below the 0.01% the stored share can hold.
    fireEvent.change(screen.getByTestId("asset-dollars"), { target: { value: "50" } });

    expect(lastDraft(onChange)).toBeNull();
    expect(screen.getByTestId("asset-dollars-too-small")).toBeTruthy();
  });

  it("round-trips a saved fractional share instead of rounding it to whole percent", () => {
    const onChange = vi.fn();
    const editing: EstateFlowGift = {
      kind: "asset-once", id: "g1", year: 2030, accountId: "a1", percent: 0.0425,
      grantor: "client", recipient: { kind: "entity", id: "t1" },
    };
    render(<GiftForm {...base({ editing, onChange })} />);

    expect((screen.getByTestId("asset-percent") as HTMLInputElement).value).toBe("4.25");
    expect(lastDraft(onChange)).toMatchObject({ percent: 0.0425 });
  });
});

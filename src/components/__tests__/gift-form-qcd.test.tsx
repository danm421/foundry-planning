// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GiftForm, { giftFormRecipientsFromClientData, type GiftFormProps } from "@/components/gift-form";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { QcdSourceOption } from "@/lib/gifts/qcd-sources";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const JANE_IRA: QcdSourceOption = {
  id: "ira1", name: "Jane IRA", owner: "client", ownerFirstName: "Jane",
  spouseFirstName: "Tom", eligibleFromYear: 2030, rmdStartYear: 2034, inherited: false,
};
const TOM_IRA: QcdSourceOption = {
  id: "ira2", name: "Tom IRA", owner: "spouse", ownerFirstName: "Tom",
  spouseFirstName: "Jane", eligibleFromYear: 2032, rmdStartYear: 2036, inherited: false,
};

const base = (over: Partial<GiftFormProps> = {}): GiftFormProps => ({
  recipients: {
    trusts: [],
    familyMembers: [{ id: "m1", firstName: "Kid", lastName: "Doe" }],
    externals: [
      { id: "pub", name: "Red Cross", kindLabel: "charity", charityType: "public" },
      { id: "priv", name: "Family Foundation", kindLabel: "charity", charityType: "private" },
    ],
  },
  accounts: [],
  hasSpouse: true,
  annualExclusionByYear: { 2026: 19_000 },
  editing: null,
  qcdSources: [JANE_IRA, TOM_IRA],
  taxInflationRate: 0.025,
  onChange: vi.fn(),
  ...over,
});

const last = (fn: ReturnType<typeof vi.fn>): EstateFlowGift | null => fn.mock.calls.at(-1)?.[0] ?? null;
const lastReason = (fn: ReturnType<typeof vi.fn>): string | null => fn.mock.calls.at(-1)?.[1] ?? null;
const pick = (v: string) => fireEvent.change(screen.getByTestId("recipient"), { target: { value: v } });
const fundingOptions = () => screen.queryByText("From an IRA");

describe("GiftForm — From an IRA", () => {
  it("offers the choice for a public charity only", () => {
    render(<GiftForm {...base()} />);
    expect(fundingOptions()).toBeNull();
    pick("family_member:m1");
    expect(fundingOptions()).toBeNull();
    pick("external_beneficiary:pub");
    expect(fundingOptions()).toBeInTheDocument();
  });

  it("never offers it for a person from the plan, though every person's row carries charity type public", () => {
    const recipients = giftFormRecipientsFromClientData(
      buildClientData({
        externalBeneficiaries: [
          { id: "ind", name: "Clara Reyes", kind: "individual", charityType: "public" },
          { id: "pub", name: "Red Cross", kind: "charity", charityType: "public" },
        ],
      }),
    );
    render(<GiftForm {...base({ recipients })} />);
    pick("external_beneficiary:ind");
    expect(fundingOptions()).toBeNull();
    pick("external_beneficiary:pub");
    expect(fundingOptions()).toBeInTheDocument();
  });

  it("says QCDs can only go to public charities for a private one, in place of the choice", () => {
    render(<GiftForm {...base()} />);
    pick("external_beneficiary:priv");
    expect(fundingOptions()).toBeNull();
    expect(screen.getByText("QCDs can only go to public charities.")).toBeInTheDocument();
  });

  it("shows neither when the household has no eligible IRA", () => {
    render(<GiftForm {...base({ qcdSources: [] })} />);
    pick("external_beneficiary:pub");
    expect(fundingOptions()).toBeNull();
    pick("external_beneficiary:priv");
    expect(screen.queryByText("QCDs can only go to public charities.")).toBeNull();
  });

  it("offers it for a recurring gift too", () => {
    render(<GiftForm {...base()} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("Recurring"));
    expect(fundingOptions()).toBeInTheDocument();
    expect(screen.queryByText("Specific asset")).toBeNull();
  });

  it("blocks with the exact reason until an IRA is chosen", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    expect(last(onChange)).toBeNull();
    expect(lastReason(onChange)).toBe("Choose the IRA the gift comes from.");
  });

  it("lists each IRA as name (owner) with the helper text and the carry-on line", () => {
    render(<GiftForm {...base()} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    const opts = [...(screen.getByTestId("qcd-account") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toContain("Jane IRA (Jane)");
    expect(opts).toContain("Tom IRA (Tom)");
    expect(
      screen.getByText("Paid straight from the IRA to the charity. Counts toward the RMD and isn't taxed. Not for donor-advised funds."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    expect(screen.getByText("If Jane dies first and the IRA passes to Tom, these gifts continue from Tom.")).toBeInTheDocument();
  });

  it("omits the carry-on line for a single household", () => {
    render(<GiftForm {...base({ qcdSources: [{ ...JANE_IRA, spouseFirstName: null }], hasSpouse: false })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    expect(screen.queryByText(/these gifts continue from/)).toBeNull();
  });

  it("Full RMD emits a zero-amount QCD draft with the owner as grantor, and locks the grantor", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira2" } });
    fireEvent.click(screen.getByText("Full RMD"));
    const d = last(onChange);
    expect(d).toMatchObject({
      kind: "cash-once", amount: 0, grantor: "spouse",
      qcd: { accountId: "ira2", amountMode: "full_rmd" },
    });
    const grantor = screen.getByTestId("grantor") as HTMLSelectElement;
    expect(grantor).toBeDisabled();
    expect(grantor.value).toBe("spouse");
    expect(screen.queryByText("Valuation discount (%)")).toBeNull();
    // qcd sits right before valuationDiscount (the diff's last-key contract).
    const keys = Object.keys(d as object);
    expect(keys.at(-2)).toBe("qcd");
    expect(keys.at(-1)).toBe("valuationDiscount");
    // The amount input is only for Fixed.
    expect(screen.queryByLabelText(/amount/i, { selector: "input" })).toBeNull();
  });

  it("Fixed amount takes an amount and emits it", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Fixed amount"));
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "20000" } });
    expect(last(onChange)).toMatchObject({
      kind: "cash-once", amount: 20_000, grantor: "client",
      qcd: { accountId: "ira1", amountMode: "fixed" },
    });
  });

  it("a recurring QCD is a fixed-mode series with qcd before valuationDiscount", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Full RMD"));
    const d = last(onChange);
    expect(d).toMatchObject({
      kind: "series", amountMode: "fixed", annualAmount: 0, grantor: "client",
      qcd: { accountId: "ira1", amountMode: "full_rmd" },
    });
    expect(Object.keys(d as object).slice(-2)).toEqual(["qcd", "valuationDiscount"]);
    expect(screen.queryByText("Valuation discount (%)")).toBeNull();
  });

  it("defaults a new recurring gift's start year to the first eligible year, or the RMD year for Full RMD", () => {
    render(<GiftForm {...base({ ledger: [{ year: 2026 } as never], annualExclusionByYear: {} })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Fixed amount"));
    expect((screen.getByLabelText("Start year") as HTMLInputElement).value).toBe("2030");
    fireEvent.click(screen.getByText("Full RMD"));
    expect((screen.getByLabelText("Start year") as HTMLInputElement).value).toBe("2034");
  });

  it("never defaults the start year earlier than the plan's first year", () => {
    render(<GiftForm {...base({ ledger: [{ year: 2040 } as never], annualExclusionByYear: {} })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Fixed amount"));
    expect((screen.getByLabelText("Start year") as HTMLInputElement).value).toBe("2040");
  });

  function fixedFixture(extra: Partial<GiftFormProps> = {}) {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange, ...extra })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Fixed amount"));
    return onChange;
  }

  it("warns when a fixed amount is above that year's QCD limit", () => {
    fixedFixture();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "150000" } });
    expect(
      screen.getByText("Above the 2026 QCD limit of $111,000. The extra is taxed, then deducted as a normal gift."),
    ).toBeInTheDocument();
  });

  it("warns when the year is before the owner turns 70½", () => {
    fixedFixture();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2028" } });
    expect(screen.getByText("Jane turns 70½ in 2030. QCDs before then are skipped.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2030" } });
    expect(screen.queryByText(/turns 70½/)).toBeNull();
  });

  it("warns when a fixed amount is above the IRA's projected balance", () => {
    fixedFixture({ accountValueAtYear: (id, y) => (id === "ira1" && y === 2031 ? 10_000 : undefined) });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2031" } });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "20000" } });
    expect(
      screen.getByText("More than Jane IRA's projected balance in 2031. The gift stops at the balance."),
    ).toBeInTheDocument();
  });

  it("switching Funding back to Cash drops qcd and unlocks the grantor", () => {
    const onChange = fixedFixture();
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "5000" } });
    expect(last(onChange)).toHaveProperty("qcd");
    fireEvent.click(screen.getByText("Cash"));
    const d = last(onChange);
    expect(d).toMatchObject({ kind: "cash-once" });
    expect(d).not.toHaveProperty("qcd");
    expect(screen.getByTestId("grantor")).not.toBeDisabled();
  });

  it("editing a saved QCD opens on it, and switching it to Cash strips qcd from the draft", () => {
    const onChange = vi.fn();
    const editing: EstateFlowGift = {
      kind: "cash-once", id: "g1", year: 2031, amount: 7_000, grantor: "client",
      recipient: { kind: "external_beneficiary", id: "pub" }, crummey: false, eventKind: "outright",
      qcd: { accountId: "ira1", amountMode: "fixed" }, valuationDiscount: undefined,
    };
    render(<GiftForm {...base({ onChange, editing })} />);
    expect((screen.getByTestId("qcd-account") as HTMLSelectElement).value).toBe("ira1");
    expect(last(onChange)).toMatchObject({ qcd: { accountId: "ira1", amountMode: "fixed" } });
    fireEvent.click(screen.getByText("Cash"));
    expect(last(onChange)).not.toHaveProperty("qcd");
  });

  it("a QCD never raises the lifetime-exemption warning", () => {
    const ledger = [{
      year: 2031,
      perGrantor: { client: { cumulativeTaxableGifts: 0, creditUsed: 0, giftTaxThisYear: 0, taxableGiftsThisYear: 0 } },
    }] as never;
    fixedFixture({ ledger });
    fireEvent.change(screen.getByLabelText(/amount/i, { selector: "input" }), { target: { value: "90000000" } });
    expect(screen.queryByText(/remaining lifetime exemption/)).toBeNull();
  });

  // ── A Full RMD QCD before RMDs start ──────────────────────────────────────
  const RMD_NOTE = "Jane's RMDs start in 2034; a Full RMD QCD gives nothing before then.";
  function fullRmdAt(year: number, extra: Partial<GiftFormProps> = {}) {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange, ...extra })} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Full RMD"));
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: String(year) } });
    return onChange;
  }

  it("warns that a Full RMD QCD gives nothing before the owner's RMDs start, without blocking it", () => {
    // Jane is 70½ from 2030 (71 in 2031); her RMDs start in 2034.
    const onChange = fullRmdAt(2031);
    expect(screen.getByText(RMD_NOTE)).toBeInTheDocument();
    expect(last(onChange)).toMatchObject({ qcd: { amountMode: "full_rmd" } });
  });

  it("drops the RMD note for a fixed amount", () => {
    fullRmdAt(2031);
    fireEvent.click(screen.getByText("Fixed amount"));
    expect(screen.queryByText(RMD_NOTE)).toBeNull();
  });

  it("drops the RMD note for an inherited IRA, whose RMDs are already due", () => {
    fullRmdAt(2031, { qcdSources: [{ ...JANE_IRA, inherited: true }] });
    expect(screen.queryByText(/RMDs start in/)).toBeNull();
  });

  it("drops the RMD note from the RMD start year on", () => {
    fullRmdAt(2034);
    expect(screen.queryByText(RMD_NOTE)).toBeNull();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2035" } });
    expect(screen.queryByText(RMD_NOTE)).toBeNull();
  });

  it("reads a recurring QCD's start year", () => {
    render(<GiftForm {...base()} />);
    pick("external_beneficiary:pub");
    fireEvent.click(screen.getByText("Recurring"));
    fireEvent.click(screen.getByText("From an IRA"));
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira1" } });
    fireEvent.click(screen.getByText("Full RMD"));
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2032" } });
    expect(screen.getByText(RMD_NOTE)).toBeInTheDocument();
  });

  // ── A saved QCD the form can no longer offer ──────────────────────────────
  const SAVED_QCD: EstateFlowGift = {
    kind: "cash-once", id: "g1", year: 2035, amount: 7_000, grantor: "client",
    recipient: { kind: "external_beneficiary", id: "pub" }, crummey: false, eventKind: "outright",
    qcd: { accountId: "ira1", amountMode: "fixed" }, valuationDiscount: undefined,
  };
  /** Every non-null draft the form emitted. */
  const drafts = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.map((c) => c[0] as EstateFlowGift | null).filter((d) => d != null);

  it("keeps a saved QCD whose charity lost its public mark as a QCD, held back with the reason", () => {
    const onChange = vi.fn();
    const recipients = { ...base().recipients, externals: [{ id: "pub", name: "Red Cross", kindLabel: "charity" }] };
    render(<GiftForm {...base({ onChange, editing: SAVED_QCD, recipients })} />);
    const reason = "Red Cross isn't marked as a public charity, so it can't take a QCD. Mark it public, or switch Funding to Cash.";
    expect(lastReason(onChange)).toBe(reason);
    expect(screen.getByTestId("qcd-unavailable")).toHaveTextContent(reason);
    // Never a cash draft: the form held the gift back the whole time.
    expect(drafts(onChange)).toEqual([]);
    // Picking Cash is the advisor's explicit choice, and only then does it become one.
    fireEvent.click(screen.getByText("Cash"));
    expect(last(onChange)).toMatchObject({ kind: "cash-once", amount: 7_000 });
    expect(last(onChange)).not.toHaveProperty("qcd");
  });

  it("names why a saved QCD's IRA can't fund it any more, and lets the advisor pick another", () => {
    const onChange = vi.fn();
    render(
      <GiftForm
        {...base({
          onChange,
          editing: SAVED_QCD,
          qcdSources: [TOM_IRA],
          qcdSourceProblems: { ira1: "Jane has no date of birth on file, so Jane IRA can't fund a QCD." },
        })}
      />,
    );
    expect(lastReason(onChange)).toBe(
      "Jane has no date of birth on file, so Jane IRA can't fund a QCD. Pick another IRA, or switch Funding to Cash.",
    );
    expect(drafts(onChange)).toEqual([]);
    fireEvent.change(screen.getByTestId("qcd-account"), { target: { value: "ira2" } });
    expect(last(onChange)).toMatchObject({ qcd: { accountId: "ira2", amountMode: "fixed" } });
  });

  it("says a saved QCD's IRA is gone when no IRA can fund one", () => {
    const onChange = vi.fn();
    render(<GiftForm {...base({ onChange, editing: SAVED_QCD, qcdSources: [] })} />);
    expect(lastReason(onChange)).toBe(
      "The IRA this QCD was paid from is no longer in the plan. Switch Funding to Cash.",
    );
    expect(screen.getByText("From an IRA")).toBeInTheDocument();
    expect(drafts(onChange)).toEqual([]);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { PropertyStep } from "../property-step";

type PropertySlice = IntakeDraft["property"];

function makeProps(
  overrides: Partial<{
    value: PropertySlice;
    onChange: (v: PropertySlice) => void;
    clientName: string;
    spouseName: string;
    hasSpouse: boolean;
  }> = {},
) {
  return {
    value: [] as PropertySlice,
    onChange: vi.fn(),
    ...overrides,
  };
}

/** Click "Edit" on the collapsed row whose name matches, expanding its editor. */
function expandRow(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

const HOME: NonNullable<PropertySlice>[number] = {
  name: "Main residence",
  kind: "real_estate",
  value: 850000,
  owner: "client",
};

describe("PropertyStep", () => {
  it("renders an Add property button when the list is empty", () => {
    render(<PropertyStep {...makeProps()} />);
    expect(screen.getByRole("button", { name: /add property/i })).toBeInTheDocument();
  });

  it("clicking Add property calls onChange with a new property entry", () => {
    const onChange = vi.fn();
    render(<PropertyStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add property/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: PropertySlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.owner).toBe("client");
    // A blank row declares no mortgage — the box starts unticked.
    expect(next?.[0]?.mortgage).toBeUndefined();
  });

  // ── Collapse-to-row ────────────────────────────────────────────────────────

  it("renders an existing property collapsed, with its kind, owner, and value", () => {
    render(<PropertyStep {...makeProps({ value: [HOME] })} />);

    expect(screen.getByText("Main residence")).toBeInTheDocument();
    expect(screen.getByText(/Real estate · Client/)).toBeInTheDocument();
    // Scoped to the row — the KPI total reads $850,000 too with one property.
    const row = screen.getByRole("button", { name: /edit main residence/i }).parentElement!;
    expect(within(row).getByText("$850,000")).toBeInTheDocument();
    // Collapsed: no editable fields until Edit is clicked.
    expect(screen.queryByDisplayValue("Main residence")).not.toBeInTheDocument();
  });

  it("shows the mortgage balance on the collapsed row", () => {
    const value: PropertySlice = [{ ...HOME, mortgage: { balance: 420000 } }];
    render(<PropertyStep {...makeProps({ value })} />);

    expect(screen.getByText(/Real estate · Client · Mortgage \$420,000/)).toBeInTheDocument();
  });

  it("totals value and mortgage balance across every property", () => {
    const value: PropertySlice = [
      { ...HOME, mortgage: { balance: 420000 } },
      { name: "Lake house", kind: "real_estate", value: 300000, owner: "joint", mortgage: { balance: 80000 } },
    ];
    render(<PropertyStep {...makeProps({ value })} />);

    expect(screen.getByText("$1,150,000")).toBeInTheDocument();
    expect(screen.getByText("$500,000")).toBeInTheDocument();
  });

  it("clicking Edit expands the row into its editable fields", () => {
    render(<PropertyStep {...makeProps({ value: [HOME] })} />);

    expandRow(/edit main residence/i);

    expect(screen.getByDisplayValue("Main residence")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /kind/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /owner/i })).toBeInTheDocument();
    // value is a formatted money field: 850000 → "850,000"
    expect(screen.getByDisplayValue("850,000")).toBeInTheDocument();
  });

  // ── Owner ──────────────────────────────────────────────────────────────────

  it("offers only the client as owner when the household has no spouse", () => {
    render(<PropertyStep {...makeProps({ value: [HOME], clientName: "Dana" })} />);
    expandRow(/edit main residence/i);

    const owner = screen.getByRole("combobox", { name: /owner/i });
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual(["Dana"]);
  });

  it("offers client, spouse, and joint once a spouse is present", () => {
    render(
      <PropertyStep
        {...makeProps({ value: [HOME], clientName: "Dana", spouseName: "Alex", hasSpouse: true })}
      />,
    );
    expandRow(/edit main residence/i);

    const owner = screen.getByRole("combobox", { name: /owner/i });
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Dana",
      "Alex",
      "Joint",
    ]);
  });

  it("changing owner calls onChange with the new owner", () => {
    const onChange = vi.fn();
    render(<PropertyStep {...makeProps({ value: [HOME], onChange, hasSpouse: true })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByRole("combobox", { name: /owner/i }), {
      target: { value: "joint" },
    });

    expect(onChange.mock.calls[0][0]?.[0]?.owner).toBe("joint");
  });

  // ── Cost basis, taxes, insurance ───────────────────────────────────────────

  it("collects cost basis, property taxes, and insurance on real estate", () => {
    const onChange = vi.fn();
    render(<PropertyStep {...makeProps({ value: [HOME], onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByLabelText("Cost basis"), { target: { value: "500000" } });
    expect(onChange.mock.calls[0][0]?.[0]?.basis).toBe(500000);

    fireEvent.change(screen.getByLabelText("Annual property taxes"), { target: { value: "12000" } });
    expect(onChange.mock.calls[1][0]?.[0]?.annualPropertyTax).toBe(12000);

    fireEvent.change(screen.getByLabelText("Annual insurance"), { target: { value: "2400" } });
    expect(onChange.mock.calls[2][0]?.[0]?.annualInsurance).toBe(2400);
  });

  it("hides taxes, insurance, and the mortgage box on a business interest", () => {
    const value: PropertySlice = [{ name: "Acme LLC", kind: "business", value: 400000, owner: "client" }];
    render(<PropertyStep {...makeProps({ value })} />);
    expandRow(/edit acme llc/i);

    // Cost basis still applies to a business interest.
    expect(screen.getByLabelText("Cost basis")).toBeInTheDocument();
    expect(screen.queryByLabelText("Annual property taxes")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Annual insurance")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("switching kind to business clears the real-estate-only answers", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [
      {
        ...HOME,
        basis: 500000,
        annualPropertyTax: 12000,
        annualInsurance: 2400,
        mortgage: { balance: 420000 },
      },
    ];
    render(<PropertyStep {...makeProps({ value, onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByRole("combobox", { name: /kind/i }), {
      target: { value: "business" },
    });

    const next = onChange.mock.calls[0][0]?.[0];
    expect(next?.kind).toBe("business");
    // A hidden field must not submit a stale number.
    expect(next?.annualPropertyTax).toBeUndefined();
    expect(next?.annualInsurance).toBeUndefined();
    expect(next?.mortgage).toBeUndefined();
    // Basis survives — a business interest has one too.
    expect(next?.basis).toBe(500000);
  });

  // ── Mortgage ───────────────────────────────────────────────────────────────

  it("hides the mortgage fields until the box is checked", () => {
    render(<PropertyStep {...makeProps({ value: [HOME] })} />);
    expandRow(/edit main residence/i);

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByLabelText("Mortgage balance remaining")).not.toBeInTheDocument();
  });

  it("checking the box adds a mortgage object and reveals its fields", () => {
    const onChange = vi.fn();
    render(<PropertyStep {...makeProps({ value: [HOME], onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange.mock.calls[0][0]?.[0]?.mortgage).toEqual({});
  });

  it("renders every mortgage field once one is declared", () => {
    const value: PropertySlice = [
      {
        ...HOME,
        mortgage: { balance: 420000, yearsRemaining: 22, interestRatePct: 6.5, monthlyPayment: 2650 },
      },
    ];
    render(<PropertyStep {...makeProps({ value })} />);
    expandRow(/edit main residence/i);

    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByLabelText("Mortgage balance remaining")).toHaveValue("420,000");
    expect(screen.getByLabelText("Years remaining on the mortgage")).toHaveValue("22");
    expect(screen.getByLabelText("Mortgage interest rate")).toHaveValue("6.5");
    expect(screen.getByLabelText("Monthly mortgage payment")).toHaveValue("2,650");
  });

  it("editing a mortgage field patches it without dropping the others", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [{ ...HOME, mortgage: { balance: 420000, interestRatePct: 6.5 } }];
    render(<PropertyStep {...makeProps({ value, onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByLabelText("Years remaining on the mortgage"), {
      target: { value: "22" },
    });

    expect(onChange.mock.calls[0][0]?.[0]?.mortgage).toEqual({
      balance: 420000,
      interestRatePct: 6.5,
      yearsRemaining: 22,
    });
  });

  it("a decimal interest rate survives being typed", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [{ ...HOME, mortgage: {} }];
    render(<PropertyStep {...makeProps({ value, onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByLabelText("Mortgage interest rate"), {
      target: { value: "6.125" },
    });

    expect(onChange.mock.calls[0][0]?.[0]?.mortgage?.interestRatePct).toBe(6.125);
  });

  it("unchecking the box drops the whole mortgage object", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [{ ...HOME, mortgage: { balance: 420000 } }];
    render(<PropertyStep {...makeProps({ value, onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange.mock.calls[0][0]?.[0]?.mortgage).toBeUndefined();
  });

  // ── Add / edit / remove ────────────────────────────────────────────────────

  it("editing name calls onChange with updated name", () => {
    const onChange = vi.fn();
    render(<PropertyStep {...makeProps({ value: [HOME], onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByDisplayValue("Main residence"), {
      target: { value: "Lake house" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.name).toBe("Lake house");
  });

  it("changing value calls onChange with numeric value", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [{ ...HOME, value: 0 }];
    render(<PropertyStep {...makeProps({ value, onChange })} />);
    expandRow(/edit main residence/i);

    fireEvent.change(screen.getByLabelText("Estimated value"), { target: { value: "650000" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.value).toBe(650000);
  });

  it("removing a collapsed row calls onChange without that property", () => {
    const onChange = vi.fn();
    const value: PropertySlice = [
      HOME,
      { name: "Acme LLC", kind: "business", value: 200000, owner: "client" },
    ];
    render(<PropertyStep {...makeProps({ value, onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /remove main residence/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: PropertySlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.name).toBe("Acme LLC");
  });
});

// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { IncomeStep } from "../income-step";

type IncomeSlice = IntakeDraft["income"];

function makeProps(overrides: Partial<{ value: IncomeSlice; onChange: (v: IncomeSlice) => void }> = {}) {
  return {
    value: [] as IncomeSlice,
    onChange: vi.fn(),
    ...overrides,
  };
}

/** Click "Edit" on the collapsed row whose name matches, expanding its editor. */
function expandRow(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("IncomeStep", () => {
  it("renders an Add income button when the list is empty", () => {
    render(<IncomeStep {...makeProps()} />);
    expect(screen.getByRole("button", { name: /add income/i })).toBeInTheDocument();
  });

  it("clicking Add income calls onChange with a new income entry", () => {
    const onChange = vi.fn();
    render(<IncomeStep {...makeProps({ onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: IncomeSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.owner).toBe("client");
  });

  it("renders an existing income source collapsed, with its type, owner, and amount", () => {
    const value: IncomeSlice = [
      { name: "Day job", type: "salary", annualAmount: 120000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    expect(screen.getByText("Day job")).toBeInTheDocument();
    expect(screen.getByText(/Salary \/ wages · Client/)).toBeInTheDocument();
    // Scoped to the row — the KPI total reads $120,000 too with one source.
    const row = screen.getByRole("button", { name: /edit day job/i }).parentElement!;
    expect(within(row).getByText("$120,000")).toBeInTheDocument();
    // Collapsed: no editable fields until Edit is clicked.
    expect(screen.queryByDisplayValue("Day job")).not.toBeInTheDocument();
  });

  it("clicking Edit expands the row into name, type, owner, and amount inputs", () => {
    const value: IncomeSlice = [
      { name: "Day job", type: "salary", annualAmount: 120000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    expandRow(/edit day job/i);

    expect(screen.getByDisplayValue("Day job")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /type/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /owner/i })).toBeInTheDocument();
    // annual amount is a formatted money field: 120000 → "120,000"
    expect(screen.getByDisplayValue("120,000")).toBeInTheDocument();
  });

  it("editing name calls onChange with updated name", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Old job", type: "salary", annualAmount: 80000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit old job/i);
    fireEvent.change(screen.getByDisplayValue("Old job"), { target: { value: "New job" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.name).toBe("New job");
  });

  it("changing type calls onChange with the new type", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "SS", type: "salary", annualAmount: 0, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit ss/i);
    fireEvent.change(screen.getByRole("combobox", { name: /type/i }), {
      target: { value: "social_security" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.type).toBe("social_security");
  });

  it("changing annualAmount calls onChange with numeric amount", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 0, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit job/i);
    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "95000" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.annualAmount).toBe(95000);
  });

  it("formats the amount with a separator as the user types (live)", () => {
    // Stateful host so the controlled money field reflects committed values.
    function Host() {
      const [income, setIncome] = useState<IncomeSlice>([
        { name: "Job", type: "salary", annualAmount: undefined, owner: "client" },
      ]);
      return <IncomeStep value={income} onChange={setIncome} />;
    }
    render(<Host />);

    expandRow(/edit job/i);
    const amount = screen.getByLabelText(/annual amount/i);
    fireEvent.change(amount, { target: { value: "50000" } });
    expect(screen.getByDisplayValue("50,000")).toBeInTheDocument();

    fireEvent.change(amount, { target: { value: "1234567" } });
    expect(screen.getByDisplayValue("1,234,567")).toBeInTheDocument();
  });

  // ── Owner ────────────────────────────────────────────────────────────────

  it("changing owner calls onChange with the new owner", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Joint income", type: "other", annualAmount: 10000, owner: "client" },
    ];
    // "joint"/"spouse" are only offered when a spouse exists
    render(<IncomeStep {...makeProps({ value, onChange })} hasSpouse />);

    expandRow(/edit joint income/i);
    fireEvent.change(screen.getByRole("combobox", { name: /owner/i }), {
      target: { value: "joint" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.owner).toBe("joint");
  });

  it("owner field lists the real client/spouse names when a spouse exists", () => {
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 100000, owner: "client" },
    ];
    render(
      <IncomeStep {...makeProps({ value })} clientName="Cooper" spouseName="Susan" hasSpouse />,
    );

    expandRow(/edit job/i);
    const ownerSelect = screen.getByRole("combobox", { name: /owner/i });
    const labels = Array.from(ownerSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["Cooper", "Susan", "Joint"]);
  });

  it("owner field offers only the client when there is no spouse", () => {
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 100000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} clientName="Cooper" />);

    expandRow(/edit job/i);
    const ownerSelect = screen.getByRole("combobox", { name: /owner/i });
    const labels = Array.from(ownerSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["Cooper"]);
  });

  it("labels a collapsed row with the spouse's name when they own it", () => {
    const value: IncomeSlice = [
      { name: "Consulting", type: "business", annualAmount: 40000, owner: "spouse" },
    ];
    render(
      <IncomeStep {...makeProps({ value })} clientName="Cooper" spouseName="Susan" hasSpouse />,
    );

    expect(screen.getByText(/Business income · Susan/)).toBeInTheDocument();
  });

  it("clicking the row's remove control calls onChange without that income entry", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Salary A", type: "salary", annualAmount: 100000, owner: "client" },
      { name: "Salary B", type: "salary", annualAmount: 80000, owner: "spouse" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /remove salary a/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next: IncomeSlice = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next?.[0]?.name).toBe("Salary B");
  });

  // ── KPI totals ───────────────────────────────────────────────────────────
  //
  // The one-editor-at-a-time machinery, Done, and the empty panel belong to
  // CardList and are covered in card-list.test.tsx. What's Income's own is
  // which totals it feeds that shell.

  it("totals the annual income and source count at the top", () => {
    const value: IncomeSlice = [
      { name: "Salary A", type: "salary", annualAmount: 100000, owner: "client" },
      { name: "Salary B", type: "salary", annualAmount: 80000, owner: "spouse" },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    const total = screen.getByText("Total annual income").parentElement!;
    expect(within(total).getByText("$180,000")).toBeInTheDocument();
    const count = screen.getByText("Income sources").parentElement!;
    expect(within(count).getByText("2")).toBeInTheDocument();
  });
});

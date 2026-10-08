// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IntakeDraft, IntakeSocialSecurity } from "@/lib/intake/schema";
import { IncomeStep } from "../income-step";

type IncomeSlice = IntakeDraft["income"];

function makeProps(
  overrides: Partial<{
    value: IncomeSlice;
    onChange: (v: IncomeSlice) => void;
    socialSecurity: IntakeSocialSecurity;
    onSocialSecurityChange: (v: IntakeSocialSecurity) => void;
  }> = {},
) {
  return {
    value: [] as IncomeSlice,
    onChange: vi.fn(),
    socialSecurity: undefined,
    onSocialSecurityChange: vi.fn(),
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
    // Seeded so the client sees a sensible year rather than a blank field.
    expect(next?.[0]?.startYear).toBe(new Date().getFullYear());
    expect(next?.[0]?.endsAtRetirement).toBe(false);
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
      { name: "Side gig", type: "salary", annualAmount: 0, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit side gig/i);
    fireEvent.change(screen.getByRole("combobox", { name: /type/i }), {
      target: { value: "business" },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]?.[0]?.type).toBe("business");
  });

  it("does not offer Social Security as a type for a new row — it has its own section", () => {
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 0, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    expandRow(/edit job/i);
    const labels = Array.from(
      screen.getByRole("combobox", { name: /type/i }).querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(labels).not.toContain("Social Security");
  });

  it("keeps the Social Security type on a row already saved as one", () => {
    const value: IncomeSlice = [
      { name: "Old SS", type: "social_security", annualAmount: 24000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    expandRow(/edit old ss/i);
    expect(screen.getByRole("combobox", { name: /type/i })).toHaveValue("social_security");
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
      return <IncomeStep {...makeProps()} value={income} onChange={setIncome} />;
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

  it("owner field lists the real client/co-client names when a co-client exists", () => {
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

  it("owner field offers only the client when there is no co-client", () => {
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 100000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value })} clientName="Cooper" />);

    expandRow(/edit job/i);
    const ownerSelect = screen.getByRole("combobox", { name: /owner/i });
    const labels = Array.from(ownerSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["Cooper"]);
  });

  it("labels a collapsed row with the co-client's name when they own it", () => {
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

  // ── Year window ──────────────────────────────────────────────────────────

  it("edits the start and end years alongside the amount", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 100000, owner: "client" },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit job/i);
    fireEvent.change(screen.getByRole("textbox", { name: /start year/i }), {
      target: { value: "2028" },
    });
    expect(onChange.mock.calls[0][0]?.[0]?.startYear).toBe(2028);

    fireEvent.change(screen.getByRole("textbox", { name: /end year/i }), {
      target: { value: "2040" },
    });
    expect(onChange.mock.calls[1][0]?.[0]?.endYear).toBe(2040);
  });

  it("reports a year only once four digits are in, so a partial entry can't submit", () => {
    // Stateful host: the year field re-syncs from its prop, so a fake onChange
    // would snap the half-typed year back the way the money field does.
    const seen: IncomeSlice[] = [];
    function Host() {
      const [income, setIncome] = useState<IncomeSlice>([
        { name: "Job", type: "salary", annualAmount: 100000, owner: "client", startYear: 2026 },
      ]);
      return (
        <IncomeStep
          {...makeProps()}
          value={income}
          onChange={(next) => {
            seen.push(next);
            setIncome(next);
          }}
        />
      );
    }
    render(<Host />);

    expandRow(/edit job/i);
    const start = screen.getByRole("textbox", { name: /start year/i });
    fireEvent.change(start, { target: { value: "20" } });

    // "20" is a valid int the submit schema would reject; it reads as blank…
    expect(seen[0]?.[0]?.startYear).toBeUndefined();
    // …but stays on screen so the user can finish typing it.
    expect(start).toHaveValue("20");

    fireEvent.change(start, { target: { value: "2028" } });
    expect(seen[1]?.[0]?.startYear).toBe(2028);
  });

  it("checking Retirement clears a stale end year", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      { name: "Job", type: "salary", annualAmount: 100000, owner: "client", endYear: 2035 },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit job/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /retirement/i }));

    const next: IncomeSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.endsAtRetirement).toBe(true);
    expect(next?.[0]?.endYear).toBeUndefined();
  });

  it("disables the end year field while Retirement is checked", () => {
    const value: IncomeSlice = [
      {
        name: "Job",
        type: "salary",
        annualAmount: 100000,
        owner: "client",
        endsAtRetirement: true,
      },
    ];
    render(<IncomeStep {...makeProps({ value })} />);

    expandRow(/edit job/i);
    expect(screen.getByRole("textbox", { name: /end year/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /retirement/i })).toBeChecked();
  });

  it("unchecking Retirement leaves the end year unset rather than inventing one", () => {
    const onChange = vi.fn();
    const value: IncomeSlice = [
      {
        name: "Job",
        type: "salary",
        annualAmount: 100000,
        owner: "client",
        endsAtRetirement: true,
      },
    ];
    render(<IncomeStep {...makeProps({ value, onChange })} />);

    expandRow(/edit job/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /retirement/i }));

    const next: IncomeSlice = onChange.mock.calls[0][0];
    expect(next?.[0]?.endsAtRetirement).toBe(false);
    expect(next?.[0]?.endYear).toBeUndefined();
  });

  it("shows the span on the collapsed row", () => {
    const value: IncomeSlice = [
      {
        name: "Day job",
        type: "salary",
        annualAmount: 120000,
        owner: "client",
        startYear: 2026,
        endsAtRetirement: true,
      },
      {
        name: "Rental",
        type: "other",
        annualAmount: 12000,
        owner: "client",
        startYear: 2026,
        endYear: 2035,
      },
    ];
    render(<IncomeStep {...makeProps({ value })} clientName="Pat" />);

    expect(screen.getByText("Salary / wages · Pat · 2026 – retirement")).toBeInTheDocument();
    expect(screen.getByText("Other · Pat · 2026 – 2035")).toBeInTheDocument();
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

  // ── Social Security ──────────────────────────────────────────────────────

  describe("Social Security section", () => {
    it("shows one row for a single client", () => {
      render(<IncomeStep {...makeProps()} clientName="Cooper" />);

      expect(screen.getByRole("heading", { name: /social security/i })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Cooper monthly benefit at 67" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Cooper start age" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: /co-client start age/i })).not.toBeInTheDocument();
    });

    it("shows a row for each person when there is a co-client", () => {
      render(<IncomeStep {...makeProps()} clientName="Cooper" spouseName="Susan" hasSpouse />);

      expect(screen.getByRole("textbox", { name: "Cooper monthly benefit at 67" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Susan monthly benefit at 67" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Susan start age" })).toBeInTheDocument();
    });

    it("offers start ages 62 through 70, with 'Not sure' as the unanswered choice", () => {
      render(<IncomeStep {...makeProps()} clientName="Cooper" />);

      const select = screen.getByRole("combobox", { name: "Cooper start age" });
      const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
      expect(labels).toEqual(["Not sure", "62", "63", "64", "65", "66", "67", "68", "69", "70"]);
      expect(select).toHaveValue("");
    });

    it("reports the monthly benefit for the person it was typed against", () => {
      const onSocialSecurityChange = vi.fn();
      render(
        <IncomeStep
          {...makeProps({
            onSocialSecurityChange,
            socialSecurity: { client: { claimingAge: 67 } },
          })}
          clientName="Cooper"
          spouseName="Susan"
          hasSpouse
        />,
      );

      fireEvent.change(screen.getByRole("textbox", { name: "Susan monthly benefit at 67" }), {
        target: { value: "2400" },
      });

      expect(onSocialSecurityChange).toHaveBeenCalledWith({
        client: { claimingAge: 67 },
        spouse: { piaMonthly: 2400 },
      });
    });

    it("keeps the benefit when a start age is picked, and clears the age on 'Not sure'", () => {
      const onSocialSecurityChange = vi.fn();
      render(
        <IncomeStep
          {...makeProps({
            onSocialSecurityChange,
            socialSecurity: { client: { piaMonthly: 3100, claimingAge: 70 } },
          })}
          clientName="Cooper"
        />,
      );

      const select = screen.getByRole("combobox", { name: "Cooper start age" });
      expect(select).toHaveValue("70");

      fireEvent.change(select, { target: { value: "62" } });
      expect(onSocialSecurityChange).toHaveBeenLastCalledWith({
        client: { piaMonthly: 3100, claimingAge: 62 },
      });

      fireEvent.change(select, { target: { value: "" } });
      expect(onSocialSecurityChange).toHaveBeenLastCalledWith({
        client: { piaMonthly: 3100, claimingAge: undefined },
      });
    });

    it("asks which age the benefit is quoted at, defaulting to full retirement age", () => {
      render(<IncomeStep {...makeProps()} clientName="Cooper" />);

      const select = screen.getByRole("combobox", { name: "Cooper benefit is at age" });
      const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
      expect(labels).toEqual([
        "at full retirement age",
        ...[62, 63, 64, 65, 66, 67, 68, 69, 70].map((a) => `at ${a}`),
      ]);
      expect(select).toHaveValue("");
    });

    it("reports the benefit age, and clears it on 'at full retirement age'", () => {
      const onSocialSecurityChange = vi.fn();
      render(
        <IncomeStep
          {...makeProps({
            onSocialSecurityChange,
            socialSecurity: { client: { piaMonthly: 5706.5 } },
          })}
          clientName="Cooper"
        />,
      );

      const select = screen.getByRole("combobox", { name: "Cooper benefit is at age" });
      fireEvent.change(select, { target: { value: "70" } });
      expect(onSocialSecurityChange).toHaveBeenLastCalledWith({
        client: { piaMonthly: 5706.5, benefitAge: 70 },
      });

      fireEvent.change(select, { target: { value: "" } });
      expect(onSocialSecurityChange).toHaveBeenLastCalledWith({
        client: { piaMonthly: 5706.5, benefitAge: undefined },
      });
    });
  });
});

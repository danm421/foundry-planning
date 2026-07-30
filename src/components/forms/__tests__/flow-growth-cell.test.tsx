// @vitest-environment jsdom
//
// Mirrors `growth-rate-cell.test.tsx` — same two-step Custom % contract, but for
// a FLOW (income / expense), whose `itemGrowthSourceEnum` is `custom |
// inflation` only. `GrowthRateCell` cannot serve this: its prop is an
// `AccountRow`, and `growthEditModeFor` knows only account categories, so a flow
// falls through to `custom_only` and never gets offered `inflation` at all.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlowGrowthCell from "../flow-growth-cell";

function setup(
  overrides: Partial<React.ComponentProps<typeof FlowGrowthCell>> = {},
) {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <FlowGrowthCell
      row={{ name: "Salary", growthRate: "0.03", growthSource: "custom" }}
      resolvedInflationRate={0.035}
      canEdit
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave };
}

describe("FlowGrowthCell", () => {
  it("renders the rate as a button when editable", () => {
    setup();
    expect(screen.getByRole("button", { name: /Change growth rate for Salary/ })).toHaveTextContent(
      "3.00%",
    );
  });

  it("renders plain text when canEdit is false", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3.00%")).toBeInTheDocument();
  });

  // Order and wording are lifted from `growthOptionsFor`'s `inflation_custom`
  // branch, so the two dropdowns over one field cannot disagree.
  it("offers exactly [Custom %, inflation], in that order", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Change growth rate for Salary/ }));
    expect(screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
      "custom",
      "inflation",
    ]);
    expect(screen.getByRole("option", { name: /3\.50% .* Inflation rate/ })).toBeInTheDocument();
  });

  it("shows the current selection when the select opens", async () => {
    const user = userEvent.setup();
    setup({ row: { name: "Salary", growthRate: "0.035", growthSource: "inflation" } });
    await user.click(screen.getByRole("button", { name: /Change growth rate for Salary/ }));
    expect(screen.getByRole("combobox")).toHaveValue("inflation");
  });

  // Flows have no "default" source, so anything that isn't `inflation` — null
  // included — reads back as `custom` rather than selecting no option at all.
  it("reads a null growthSource back as custom", async () => {
    const user = userEvent.setup();
    setup({ row: { name: "Salary", growthRate: "0.03", growthSource: null } });
    await user.click(screen.getByRole("button", { name: /Change growth rate for Salary/ }));
    expect(screen.getByRole("combobox")).toHaveValue("custom");
  });

  it("saves growthSource alone when Inflation is picked", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("button", { name: /Change growth rate for Salary/ }));
    await user.selectOptions(screen.getByRole("combobox"), "inflation");
    // NOT `{ growthRate: null }`: a null growthRate reaches the engine as a
    // literal zero and flatlines the row for the whole projection.
    expect(onSave).toHaveBeenCalledWith({ growthSource: "inflation" });
  });

  it("arms the percent editor instead of saving when Custom % is picked", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      row: { name: "Salary", growthRate: "0.03", growthSource: "inflation" },
    });
    await user.click(screen.getByRole("button", { name: /Change growth rate for Salary/ }));
    await user.selectOptions(screen.getByRole("combobox"), "custom");

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Edit amount for Salary growth rate/ }),
    ).toBeInTheDocument();
  });

  it("saves rate and source TOGETHER when the custom percent is committed", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({
      row: { name: "Salary", growthRate: "0.03", growthSource: "inflation" },
    });
    await user.click(screen.getByRole("button", { name: /Change growth rate for Salary/ }));
    await user.selectOptions(screen.getByRole("combobox"), "custom");
    await user.click(screen.getByRole("button", { name: /Edit amount for Salary growth rate/ }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "8{Enter}");

    // Both keys, one write — the engine never sees `custom` with a stale rate.
    expect(onSave).toHaveBeenCalledWith({ growthRate: "0.08", growthSource: "custom" });
  });
});

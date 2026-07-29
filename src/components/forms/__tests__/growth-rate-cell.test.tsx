// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GrowthRateCell from "../growth-rate-cell";
import type { AccountRow } from "@/components/balance-sheet-view";

const growthContext = {
  modelPortfolios: [{ id: "mp-1", name: "Balanced", blendedReturn: 0.062, riskLevel: null }],
  fundPortfolios: [],
  // Deliberately DIFFERENT from the `resolvedInflationRate` prop below. The
  // component must label the inflation option from the scenario-effective prop,
  // not from this base-scoped field — see the prop's doc comment.
  resolvedInflationRate: 0.025,
  categoryDefaults: { retirement: { portfolioName: "Core", blendedReturnPct: 5.4 } },
};

// Decimal-string rates, a different map from growthContext.categoryDefaults.
const categoryDefaultRates = { retirement: "0.054", taxable: "0.062" };

// Every render below passes these; declared once to keep the cases readable.
const ctxProps = { growthContext, categoryDefaultRates, resolvedInflationRate: 0.035 };

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acct-1",
    name: "IRA",
    category: "retirement",
    growthRate: "0.062",
    growthSource: "default",
    modelPortfolioId: null,
    tickerPortfolioId: null,
    ...overrides,
  } as AccountRow;
}

describe("GrowthRateCell", () => {
  it("renders the rate as a button when editable", () => {
    render(<GrowthRateCell row={row()} {...ctxProps} canEdit onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Change growth rate for IRA/ })).toHaveTextContent(
      "6.20%",
    );
  });

  it("renders plain text when canEdit is false", () => {
    render(<GrowthRateCell row={row()} {...ctxProps} canEdit={false} onSave={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("6.20%")).toBeInTheDocument();
  });

  it("renders plain text for stock_options — the form has no growth control", () => {
    render(
      <GrowthRateCell
        row={row({ category: "stock_options" })}
        {...ctxProps}
        canEdit
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens a select showing the current selection", async () => {
    const user = userEvent.setup();
    render(
      <GrowthRateCell
        row={row({ growthSource: "model_portfolio", modelPortfolioId: "mp-1" })}
        {...ctxProps}
        canEdit
        onSave={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    expect(screen.getByRole("combobox")).toHaveValue("mp:mp-1");
  });

  it("offers Asset mix only to an account already using it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <GrowthRateCell row={row({ category: "taxable" })} {...ctxProps} canEdit onSave={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    expect(screen.queryByRole("option", { name: /Asset mix/ })).not.toBeInTheDocument();
    unmount();

    render(
      <GrowthRateCell
        row={row({ category: "taxable", growthSource: "asset_mix" })}
        {...ctxProps}
        canEdit
        onSave={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    expect(screen.getByRole("option", { name: /Asset mix/ })).toBeInTheDocument();
  });

  it("saves immediately when a resolving option is picked", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<GrowthRateCell row={row()} {...ctxProps} canEdit onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    await user.selectOptions(screen.getByRole("combobox"), "inflation");

    expect(onSave).toHaveBeenCalledWith({
      growthSource: "inflation",
      modelPortfolioId: null,
      tickerPortfolioId: null,
    });
  });

  it("arms the percent editor instead of saving when Custom is picked", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<GrowthRateCell row={row()} {...ctxProps} canEdit onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    await user.selectOptions(screen.getByRole("combobox"), "custom");

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Edit amount for IRA growth rate/ }),
    ).toBeInTheDocument();
  });

  it("saves source and rate together when the custom percent is committed", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<GrowthRateCell row={row()} {...ctxProps} canEdit onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    await user.selectOptions(screen.getByRole("combobox"), "custom");
    await user.click(screen.getByRole("button", { name: /Edit amount for IRA growth rate/ }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "8{Enter}");

    expect(onSave).toHaveBeenCalledWith({
      growthSource: "custom",
      modelPortfolioId: null,
      tickerPortfolioId: null,
      growthRate: "0.08",
    });
  });

  // The label must follow a scenario that overrides inflation. `growthContext`
  // is loaded against the BASE scenario id, so its rate is 2.50% here while the
  // scenario-effective prop says 3.50%. Reading the wrong one tells the advisor
  // a number the projection will not use.
  it("labels the inflation option from the scenario-effective rate, not growthContext's", async () => {
    const user = userEvent.setup();
    render(
      <GrowthRateCell row={row({ category: "real_estate" })} {...ctxProps} canEdit onSave={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    expect(screen.getByRole("option", { name: /3\.50% .* Inflation rate/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /2\.50%/ })).not.toBeInTheDocument();
  });

  // R11: same options as the form, in the form's order.
  it("orders the real_estate options as [Custom %, inflation], matching the form", async () => {
    const user = userEvent.setup();
    render(
      <GrowthRateCell row={row({ category: "real_estate" })} {...ctxProps} canEdit onSave={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /Change growth rate for IRA/ }));
    const values = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["custom", "inflation"]);
  });
});

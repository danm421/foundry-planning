// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GrowthRateField, parseGrowthSourceSelection } from "./growth-rate-field";

const baseProps = {
  category: "taxable",
  growthSource: "default" as const,
  modelPortfolioId: "",
  growthRatePct: "7",
  modelPortfolios: [{ id: "mp1", name: "Balanced", blendedReturn: 0.06 }],
  defaultPctForCategory: 5,
  catDefaultPortfolioName: "House Default",
  resolvedInflationRate: 0.025,
  assetMixBlendedPct: null,
  onSourceChange: () => {},
  onCustomPctChange: () => {},
};

describe("parseGrowthSourceSelection", () => {
  it("maps each raw value", () => {
    expect(parseGrowthSourceSelection("default")).toEqual({ growthSource: "default", modelPortfolioId: null, tickerPortfolioId: null });
    expect(parseGrowthSourceSelection("mp:abc")).toEqual({ growthSource: "model_portfolio", modelPortfolioId: "abc", tickerPortfolioId: null });
    expect(parseGrowthSourceSelection("asset_mix")).toEqual({ growthSource: "asset_mix", modelPortfolioId: null, tickerPortfolioId: null });
    expect(parseGrowthSourceSelection("inflation")).toEqual({ growthSource: "inflation", modelPortfolioId: null, tickerPortfolioId: null });
    expect(parseGrowthSourceSelection("custom")).toEqual({ growthSource: "custom", modelPortfolioId: null, tickerPortfolioId: null });
  });

  it("parseGrowthSourceSelection maps tp: to ticker_portfolio", () => {
    expect(parseGrowthSourceSelection("tp:tp1")).toEqual({ growthSource: "ticker_portfolio", modelPortfolioId: null, tickerPortfolioId: "tp1" });
  });
});

describe("GrowthRateField", () => {
  it("renders model-portfolio + inflation options for taxable; asset-mix included", () => {
    render(<GrowthRateField {...baseProps} />);
    expect(screen.getByRole("option", { name: /Balanced/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Inflation rate/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Asset mix/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Custom %/ })).toBeInTheDocument();
  });

  it("omits inflation option for an unsupported category", () => {
    render(<GrowthRateField {...baseProps} category="business" />);
    expect(screen.queryByRole("option", { name: /Inflation rate/ })).not.toBeInTheDocument();
  });

  it("calls onSourceChange with the raw select value", () => {
    const onSourceChange = vi.fn();
    render(<GrowthRateField {...baseProps} onSourceChange={onSourceChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mp:mp1" } });
    expect(onSourceChange).toHaveBeenCalledWith("mp:mp1");
  });

  it("shows the custom percent input only when growthSource is custom", () => {
    const { rerender } = render(<GrowthRateField {...baseProps} growthSource="default" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    rerender(<GrowthRateField {...baseProps} growthSource="custom" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders fund portfolios as tp:<id> options and parses them", () => {
    render(
      <GrowthRateField
        category="taxable" growthSource="default" modelPortfolioId="" growthRatePct=""
        modelPortfolios={[]} fundPortfolios={[{ id: "tp1", name: "My Fund Sleeve", blendedReturnPct: 5.98 }]}
        defaultPctForCategory={7} catDefaultPortfolioName="Aggressive (100/0)"
        resolvedInflationRate={0.024} assetMixBlendedPct={null}
        onSourceChange={() => {}} onCustomPctChange={() => {}}
      />,
    );
    expect(screen.getByRole("option", { name: /5\.98% — My Fund Sleeve/ })).toBeInTheDocument();
  });

  it("labels the inherit row as a plan default, not a bare portfolio name", () => {
    render(
      <GrowthRateField
        category="taxable"
        growthSource="default"
        modelPortfolioId=""
        growthRatePct=""
        modelPortfolios={[{ id: "agg", name: "Aggressive (100/0)", blendedReturn: 0.0723 }]}
        defaultPctForCategory={7.23}
        catDefaultPortfolioName="Aggressive (100/0)"
        resolvedInflationRate={0.024}
        assetMixBlendedPct={null}
        onSourceChange={() => {}}
        onCustomPctChange={() => {}}
      />,
    );
    // The inherit option now reads "Plan default — …", distinct from the pinned row.
    expect(screen.getByRole("option", { name: /^Plan default — 7\.23% Aggressive \(100\/0\)$/ })).toBeInTheDocument();
    // The pinned portfolio row still exists separately.
    expect(screen.getByRole("option", { name: /^7\.23% — Aggressive \(100\/0\)$/ })).toBeInTheDocument();
  });
});

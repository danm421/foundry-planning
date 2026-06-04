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
    expect(parseGrowthSourceSelection("default")).toEqual({ growthSource: "default", modelPortfolioId: null });
    expect(parseGrowthSourceSelection("mp:abc")).toEqual({ growthSource: "model_portfolio", modelPortfolioId: "abc" });
    expect(parseGrowthSourceSelection("asset_mix")).toEqual({ growthSource: "asset_mix", modelPortfolioId: null });
    expect(parseGrowthSourceSelection("inflation")).toEqual({ growthSource: "inflation", modelPortfolioId: null });
    expect(parseGrowthSourceSelection("custom")).toEqual({ growthSource: "custom", modelPortfolioId: null });
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
});

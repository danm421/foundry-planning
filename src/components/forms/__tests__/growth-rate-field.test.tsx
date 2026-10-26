// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GrowthRateField } from "../growth-rate-field";

const base = {
  category: "retirement",
  growthSource: "default" as const,
  modelPortfolioId: "",
  growthRatePct: "",
  modelPortfolios: [],
  defaultPctForCategory: 6,
  resolvedInflationRate: 0.025,
  assetMixBlendedPct: null,
  onSourceChange: vi.fn(),
  onCustomPctChange: vi.fn(),
};

describe("GrowthRateField — hideAssetMix", () => {
  it("shows the Asset mix option by default for retirement", () => {
    render(<GrowthRateField {...base} />);
    expect(screen.getByText(/Asset mix/i)).toBeInTheDocument();
  });

  it("hides the Asset mix option when hideAssetMix is set", () => {
    render(<GrowthRateField {...base} hideAssetMix />);
    expect(screen.queryByText(/Asset mix/i)).not.toBeInTheDocument();
  });
});

describe("GrowthRateField — an account already on an asset mix", () => {
  // `syncAccountFromHoldings` stamps growth_source = 'asset_mix' on ANY
  // holdings-backed account, whatever its category. When the dropdown then
  // refuses to render that option the <select> has no matching <option>, so
  // the browser displays the FIRST one ("Plan default") while the engine goes
  // on using the mix — and the next save writes the lie back. The stored
  // source is therefore always offered, whatever the category says.
  it("offers Asset mix for an annuity that is already on one", () => {
    render(<GrowthRateField {...base} category="annuity" growthSource="asset_mix" />);
    expect(screen.getByRole("option", { name: /Asset mix/i })).toBeInTheDocument();
  });

  it("offers Asset mix for a cash account that is already on one", () => {
    render(<GrowthRateField {...base} category="cash" growthSource="asset_mix" />);
    expect(screen.getByRole("option", { name: /Asset mix/i })).toBeInTheDocument();
  });

  it("still offers it when hideAssetMix would otherwise suppress it", () => {
    render(<GrowthRateField {...base} growthSource="asset_mix" hideAssetMix />);
    expect(screen.getByRole("option", { name: /Asset mix/i })).toBeInTheDocument();
  });

  it("does NOT offer Asset mix to an annuity that is not on one", () => {
    render(<GrowthRateField {...base} category="annuity" />);
    expect(screen.queryByText(/Asset mix/i)).not.toBeInTheDocument();
  });
});

describe("GrowthRateField — the face shows the rate it resolves to", () => {
  it("reads the plan default as a rate and its source", () => {
    render(<GrowthRateField {...base} category="cash" defaultPctForCategory={2.4} catDefaultPortfolioName="Inflation" />);
    expect(screen.getByText("2.40%")).toBeInTheDocument();
    expect(screen.getByText("Plan default · Inflation")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2.40% — Plan default · Inflation" })).toBeInTheDocument();
  });

  it("follows a model portfolio pick", () => {
    render(<GrowthRateField {...base} growthSource="model_portfolio" modelPortfolioId="bal"
      modelPortfolios={[{ id: "bal", name: "Balanced 60/40", blendedReturn: 0.062 }]} />);
    expect(screen.getByText("6.20%")).toBeInTheDocument();
    expect(screen.getByText("Balanced 60/40")).toBeInTheDocument();
  });

  it("puts the % box beside the dropdown for a custom rate", () => {
    render(<GrowthRateField {...base} growthSource="custom" growthRatePct="5" />);
    expect((screen.getByLabelText("Custom growth rate") as HTMLInputElement).value).toBe("5");
    expect(screen.getByRole("combobox", { name: "Growth Rate" })).toBeInTheDocument();
  });
});

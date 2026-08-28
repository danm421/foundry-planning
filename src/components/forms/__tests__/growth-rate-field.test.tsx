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
    expect(screen.getByText(/Asset mix/i)).toBeInTheDocument();
  });

  it("offers Asset mix for a cash account that is already on one", () => {
    render(<GrowthRateField {...base} category="cash" growthSource="asset_mix" />);
    expect(screen.getByText(/Asset mix/i)).toBeInTheDocument();
  });

  it("still offers it when hideAssetMix would otherwise suppress it", () => {
    render(<GrowthRateField {...base} growthSource="asset_mix" hideAssetMix />);
    expect(screen.getByText(/Asset mix/i)).toBeInTheDocument();
  });

  it("does NOT offer Asset mix to an annuity that is not on one", () => {
    render(<GrowthRateField {...base} category="annuity" />);
    expect(screen.queryByText(/Asset mix/i)).not.toBeInTheDocument();
  });
});

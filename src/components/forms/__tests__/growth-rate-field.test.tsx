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

// src/components/portal/__tests__/asset-type-pie.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetTypePie } from "@/components/portal/asset-type-pie";

const GROUPS = [
  { category: "cash", label: "Cash", total: 10_000 },
  { category: "taxable", label: "Taxable", total: 30_000 },
  { category: "real_estate", label: "Real estate", total: 60_000 },
];

function wedges(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll("path")];
}

describe("AssetTypePie", () => {
  it("draws one wedge per category and lists each with its dollars and share", () => {
    const { container } = render(<AssetTypePie groups={GROUPS} />);
    expect(wedges(container)).toHaveLength(3);
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByText("$60,000")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  // Each category owns a hue keyed by name, so the same type keeps its color
  // when a sibling drops out — a positional palette would reshuffle them.
  it("colors a category from its own token, not its position", () => {
    const { container } = render(<AssetTypePie groups={GROUPS} />);
    const full = wedges(container).map((p) => p.getAttribute("fill"));
    const { container: c2 } = render(<AssetTypePie groups={GROUPS.slice(1)} />);
    expect(wedges(c2).map((p) => p.getAttribute("fill"))).toEqual(full.slice(1));
  });

  // A lone slice is a full turn: its start and end angles coincide, so an arc
  // command would collapse to nothing and paint an empty tile.
  it("paints a whole circle when one category holds everything", () => {
    const { container } = render(<AssetTypePie groups={[GROUPS[0]]} />);
    expect(wedges(container)).toHaveLength(0);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  // Shares run against the drawable slices, so the wedges and the percentages
  // both close on a full 100 even when a category carries no balance.
  it("ignores empty categories rather than drawing a zero-width wedge", () => {
    const { container } = render(
      <AssetTypePie groups={[...GROUPS, { category: "annuity", label: "Annuity", total: 0 }]} />,
    );
    expect(wedges(container)).toHaveLength(3);
    expect(screen.queryByText("Annuity")).toBeNull();
  });

  it("renders nothing when no category holds a balance", () => {
    const { container } = render(
      <AssetTypePie groups={[{ category: "cash", label: "Cash", total: 0 }]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("floors a tiny-but-real slice at <1% rather than 0%", () => {
    render(
      <AssetTypePie
        groups={[
          { category: "cash", label: "Cash", total: 20 },
          { category: "taxable", label: "Taxable", total: 100_000 },
        ]}
      />,
    );
    expect(screen.getByText("<1%")).toBeInTheDocument();
  });
});

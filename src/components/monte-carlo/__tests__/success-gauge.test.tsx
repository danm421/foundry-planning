// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SuccessGauge } from "../success-gauge";

function getFillDasharray(container: HTMLElement): string {
  const fillArc = container.querySelector("[data-testid='gauge-fill']") as SVGPathElement;
  return fillArc.getAttribute("stroke-dasharray") ?? "";
}

function parseFillLength(dasharray: string): number {
  // dasharray is "<filled> <remaining>" — we care about the filled portion
  const [filled] = dasharray.trim().split(/\s+/);
  return parseFloat(filled);
}

describe("SuccessGauge", () => {
  it("renders 0% with zero fill", () => {
    const { container } = render(<SuccessGauge value={0} />);
    expect(parseFillLength(getFillDasharray(container))).toBeCloseTo(0, 1);
  });

  it("renders 100% with full-arc fill", () => {
    const { container } = render(<SuccessGauge value={1} />);
    const total = Math.PI * 70; // radius 70 × PI for a 180° arc
    expect(parseFillLength(getFillDasharray(container))).toBeCloseTo(total, 0);
  });

  it("renders 50% with half-arc fill", () => {
    const { container } = render(<SuccessGauge value={0.5} />);
    const total = Math.PI * 70;
    expect(parseFillLength(getFillDasharray(container))).toBeCloseTo(total / 2, 0);
  });

  it("renders the percentage label in the center", () => {
    const { container } = render(<SuccessGauge value={0.88} />);
    const label = container.querySelector("[data-testid='gauge-label']");
    expect(label?.textContent).toBe("88%");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MonteCarloSkeleton from "../loading-skeleton";

describe("MonteCarloSkeleton", () => {
  it("renders the light layout skeleton blocks", () => {
    const { container } = render(<MonteCarloSkeleton />);
    expect(container.querySelectorAll(".skeleton-block").length).toBeGreaterThan(0);
  });

  it("renders the animated fan mark (draw-in strokes + breathing halo)", () => {
    const { container } = render(<MonteCarloSkeleton />);
    // The branded fan mark draws each stroke in via the shared `.mark-draw`
    // class; five strokes make up the probability cone.
    expect(container.querySelectorAll("svg .mark-draw").length).toBe(5);
    // The breathing verdigris halo sits behind the mark.
    expect(container.querySelector(".mark-halo")).toBeTruthy();
  });

  it("exposes exactly one role=status line announcing the running simulation", () => {
    const { container } = render(<MonteCarloSkeleton />);
    const labels = container.querySelectorAll(".sr-only");
    expect(labels.length).toBe(1);
    expect(labels[0].getAttribute("role")).toBe("status");
    expect(labels[0].textContent).toContain("Monte Carlo");
  });
});

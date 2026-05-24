// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NetWorthSkeleton from "../loading-skeleton";

describe("NetWorthSkeleton", () => {
  it("renders skeleton blocks", () => {
    const { container } = render(<NetWorthSkeleton />);
    expect(container.querySelectorAll(".skeleton-block").length).toBeGreaterThan(0);
  });
  it("exposes exactly one sr-only loading label", () => {
    const { container } = render(<NetWorthSkeleton />);
    const labels = container.querySelectorAll(".sr-only");
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toContain("Loading");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton, SkeletonText, LoadingLabel } from "../skeleton";

describe("Skeleton", () => {
  it("renders a shimmer block marked aria-hidden", () => {
    const { container } = render(<Skeleton width="50%" height="2rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("skeleton-block");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.style.width).toBe("50%");
  });
});

describe("SkeletonText", () => {
  it("renders the requested number of lines", () => {
    const { container } = render(<SkeletonText lines={4} />);
    expect(container.querySelectorAll(".skeleton-block").length).toBe(4);
  });
});

describe("LoadingLabel", () => {
  it("renders an sr-only label with default text", () => {
    const { getByText } = render(<LoadingLabel />);
    expect(getByText("Loading…").className).toContain("sr-only");
  });
});

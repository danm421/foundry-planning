// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { textWidget } from "../text";
import type { ComparisonPlan } from "../../build-comparison-plans";

const ctx = (config: unknown) => ({
  clientId: "c",
  plans: [] as ComparisonPlan[],
  mc: null,
  collapsed: false,
  config,
});

describe("textWidget", () => {
  it("renders markdown with bold + lists", () => {
    const { container } = render(
      <>{textWidget.render(ctx({ markdown: "Hello **world**\n\n- item 1\n- item 2" }))}</>,
    );
    expect(container.querySelector("strong")?.textContent).toBe("world");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders an empty state when config is missing", () => {
    const { container } = render(<>{textWidget.render(ctx(undefined))}</>);
    expect(container.textContent).toContain("Empty text block");
  });

  it("renders an empty state when markdown is whitespace-only", () => {
    const { container } = render(
      <>{textWidget.render(ctx({ markdown: "   \n  " }))}</>,
    );
    expect(container.textContent).toContain("Empty text block");
  });

  it("returns null when collapsed", () => {
    const ctxCollapsed = { ...ctx({ markdown: "hi" }), collapsed: true };
    const { container } = render(<>{textWidget.render(ctxCollapsed)}</>);
    expect(container.textContent).toBe("");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { textWidget } from "../text";
import { IDLE_MC_RUN } from "../types";
import type { ComparisonPlan } from "../../build-comparison-plans";

const noPlans: ComparisonPlan[] = [];
const baseCtx = {
  instanceId: "11111111-1111-4111-8111-111111111111",
  cellId: "cell-aaa",
  clientId: "c",
  plans: noPlans,
  mc: null,
  mcRun: IDLE_MC_RUN,
  yearRange: null,
};

describe("textWidget", () => {
  it("renders a clamped markdown preview when body is non-empty", () => {
    const { container, getByRole } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: false,
        config: { markdown: "# Heading\n\nBody **bold**" },
      })}</>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(getByRole("button", { name: /show full/i })).toBeTruthy();
  });

  it("renders an empty-state click target when markdown is empty", () => {
    const { getByText } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: true,
        config: { markdown: "" },
      })}</>,
    );
    expect(getByText(/Empty text block/i)).toBeTruthy();
  });

  it("calls onExpand with the cellId and current edit mode when the Expand button is clicked", () => {
    const onExpand = vi.fn();
    const { getByRole } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: true,
        config: { markdown: "hello" },
        onExpand,
      })}</>,
    );
    fireEvent.click(getByRole("button", { name: /expand to edit/i }));
    expect(onExpand).toHaveBeenCalledWith("cell-aaa", "edit");
  });

  it("uses view mode when not editing", () => {
    const onExpand = vi.fn();
    const { getByRole } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: false,
        config: { markdown: "hello" },
        onExpand,
      })}</>,
    );
    fireEvent.click(getByRole("button", { name: /show full/i }));
    expect(onExpand).toHaveBeenCalledWith("cell-aaa", "view");
  });
});

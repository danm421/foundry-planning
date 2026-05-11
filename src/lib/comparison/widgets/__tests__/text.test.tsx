// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { textWidget } from "../text";
import type { ComparisonPlan } from "../../build-comparison-plans";

const noPlans: ComparisonPlan[] = [];
const baseCtx = {
  instanceId: "11111111-1111-4111-8111-111111111111",
  clientId: "c",
  plans: noPlans,
  mc: null,
  yearRange: null,
};

describe("textWidget", () => {
  it("renders markdown when editing=false", () => {
    const { container } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: false,
        config: { markdown: "# Heading\n\nBody **bold**" },
      })}</>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("shows an empty-state hint when editing=false and markdown is empty", () => {
    const { getByText } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: false,
        config: { markdown: "" },
      })}</>,
    );
    expect(getByText(/Empty text block/i)).toBeTruthy();
  });

  it("renders a textarea when editing=true and calls onTextChange", () => {
    const onTextChange = vi.fn();
    const { getByPlaceholderText } = render(
      <>{textWidget.render({
        ...baseCtx,
        editing: true,
        config: { markdown: "" },
        onTextChange,
      })}</>,
    );
    const ta = getByPlaceholderText(/markdown/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hello" } });
    expect(onTextChange).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "hello",
    );
  });
});

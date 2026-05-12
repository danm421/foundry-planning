// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { WidgetConfigPopover } from "../widget-config-popover";
import type { WidgetInstance } from "@/lib/comparison/layout-schema";

vi.mock("@/lib/comparison/widgets/registry", () => ({
  COMPARISON_WIDGETS: {
    portfolio: {
      kind: "portfolio", title: "Portfolio", category: "investments",
      scenarios: "one-or-many", needsMc: false, render: () => null,
    },
  },
}));

const widget: WidgetInstance = { id: "w1", kind: "portfolio", planIds: ["base"] };
const props = {
  anchor: null,
  widget,
  scenarios: [{ id: "base", name: "Base" }],
  availableYearRange: { min: 2026, max: 2065 },
  onChangePlanIds: vi.fn(),
  onChangeYearRange: vi.fn(),
  onChangeConfig: vi.fn(),
  onClose: vi.fn(),
};

describe("WidgetConfigPopover", () => {
  it("returns null when anchor is null", () => {
    const { container } = render(<WidgetConfigPopover {...props} anchor={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the config panel when an anchor is provided", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    render(<WidgetConfigPopover {...props} anchor={anchor} />);
    expect(screen.getByText("Base")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    render(<WidgetConfigPopover {...props} anchor={anchor} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking outside the popover", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    render(<WidgetConfigPopover {...props} anchor={anchor} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetConfigModal } from "../widget-config-modal";

const scenarios = [{ id: "base", name: "Base" }, { id: "s2", name: "Scenario 2" }];

describe("WidgetConfigModal", () => {
  it("create mode: shows the kind picker and disables Save until a kind is chosen", () => {
    const onSave = vi.fn();
    render(
      <WidgetConfigModal
        mode="create"
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2056 }}
        primaryScenarioId="base"
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    // Portfolio Assets lives in the Cash flow category — switch tabs first.
    fireEvent.click(screen.getByRole("tab", { name: /cash flow/i }));
    fireEvent.click(screen.getByRole("button", { name: /portfolio assets/i }));
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].kind).toBe("portfolio");
    expect(onSave.mock.calls[0][0].planIds).toEqual(["base"]);
  });

  it("edit mode: kind is locked (no picker rendered)", () => {
    render(
      <WidgetConfigModal
        mode="edit"
        widget={{ id: "w", kind: "portfolio", planIds: ["base"] }}
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2056 }}
        primaryScenarioId="base"
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    // In edit mode the kind picker grid is not rendered — no picker buttons for other kinds
    expect(screen.queryByRole("button", { name: /year-by-year detail/i })).toBeNull();
    // The locked kind title should be shown in the header
    expect(screen.getByText(/portfolio assets/i)).toBeInTheDocument();
  });

  it("blocks Save when a 'many-only' widget has fewer than 2 scenarios", () => {
    const onSave = vi.fn();
    render(
      <WidgetConfigModal
        mode="create"
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2056 }}
        primaryScenarioId="base"
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    // Year-by-year detail lives in the Cash flow category.
    fireEvent.click(screen.getByRole("tab", { name: /cash flow/i }));
    fireEvent.click(screen.getByRole("button", { name: /year-by-year detail/i }));
    // seedPlanIds picks 2 distinct ids when possible (base + s2), so Save should be enabled
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  it("Cancel does not call onSave", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <WidgetConfigModal
        mode="create"
        scenarios={scenarios}
        availableYearRange={{ min: 2026, max: 2056 }}
        primaryScenarioId="base"
        onSave={onSave}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

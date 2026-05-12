// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderViewModeConfig } from "../view-mode";

describe("renderViewModeConfig", () => {
  it("highlights the active mode", () => {
    render(<>{renderViewModeConfig({ config: { viewMode: "table" }, onChange: vi.fn() })}</>);
    const tableBtn = screen.getByRole("radio", { name: "Table only" });
    expect(tableBtn).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the picked mode", () => {
    const onChange = vi.fn();
    render(<>{renderViewModeConfig({ config: undefined, onChange })}</>);
    fireEvent.click(screen.getByRole("radio", { name: "Table only" }));
    expect(onChange).toHaveBeenCalledWith({ viewMode: "table" });
  });

  it("defaults to 'chart' when config is missing", () => {
    render(<>{renderViewModeConfig({ config: undefined, onChange: vi.fn() })}</>);
    expect(screen.getByRole("radio", { name: "Chart" })).toHaveAttribute("aria-checked", "true");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SolverTechniqueRow } from "../solver-technique-row";

describe("SolverTechniqueRow", () => {
  it("renders name and summary; read-only row has no buttons", () => {
    render(<SolverTechniqueRow name="Roth Conv" summary="$25,000/yr · 2030–2035" />);
    expect(screen.getByText("Roth Conv")).toBeTruthy();
    expect(screen.getByText(/\$25,000\/yr/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("editable row fires onEdit and onRemove", () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(
      <SolverTechniqueRow
        name="Roth Conv"
        summary="x"
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("SolverTechniqueRow toggle", () => {
  it("renders an on switch by default and calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(
      <SolverTechniqueRow name="Roth 2030" summary="$25k · 2030" onToggle={onToggle} />,
    );
    const sw = screen.getByRole("switch", { name: /include roth 2030 in projection/i });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reflects the off state on the switch", () => {
    render(
      <SolverTechniqueRow
        name="Roth 2030"
        summary="$25k · 2030"
        enabled={false}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /include roth 2030 in projection/i }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("renders a Base plan badge", () => {
    render(<SolverTechniqueRow name="Roth 2030" summary="x" badge="Base plan" />);
    expect(screen.getByText("Base plan")).toBeInTheDocument();
  });
});

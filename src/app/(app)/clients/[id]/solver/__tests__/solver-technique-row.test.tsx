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

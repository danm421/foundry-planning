// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionPicker } from "../section-picker";
import { DEFAULT_INTAKE_SECTIONS } from "@/lib/intake/sections";

describe("SectionPicker", () => {
  it("selects the matching preset chip for the current value", () => {
    render(<SectionPicker value={[...DEFAULT_INTAKE_SECTIONS]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /full intake$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("falls back to Custom when the value matches no preset", () => {
    render(<SectionPicker value={["family", "accounts"]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /custom/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /full intake$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking a preset emits that preset's sections", () => {
    const onChange = vi.fn();
    render(<SectionPicker value={[...DEFAULT_INTAKE_SECTIONS]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /documents only/i }));
    expect(onChange).toHaveBeenCalledWith(["documents"]);
  });

  it("toggling a checkbox emits a canonically ordered set", () => {
    const onChange = vi.fn();
    render(<SectionPicker value={["documents"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /family/i }));
    expect(onChange).toHaveBeenCalledWith(["family", "documents"]);
  });

  it("unchecking a section emits the set without it", () => {
    const onChange = vi.fn();
    render(<SectionPicker value={["family", "documents"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /documents/i }));
    expect(onChange).toHaveBeenCalledWith(["family"]);
  });

  it("disables the Family checkbox when family is locked", () => {
    render(<SectionPicker value={["family", "documents"]} onChange={vi.fn()} familyLocked />);
    expect(screen.getByRole("checkbox", { name: /family/i })).toBeDisabled();
  });

  it("never emits an empty set — unchecking the last section is a no-op", () => {
    const onChange = vi.fn();
    render(<SectionPicker value={["documents"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /documents/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers every section as a checkbox, including risk", () => {
    render(<SectionPicker value={[...DEFAULT_INTAKE_SECTIONS]} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /risk/i })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  });
});

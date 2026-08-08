// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrmImportFixes } from "../crm-import-fixes";
import type { ParsedRow } from "@/lib/crm/import/rows";

function row(over: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rowIndex: 0,
    household: { name: "Jane Smith", nameIsCustom: false, status: "prospect" },
    primary: { role: "primary", firstName: "Jane", lastName: "Smith" },
    errors: [],
    warnings: [],
    ...over,
  } as ParsedRow;
}

describe("CrmImportFixes", () => {
  it("renders nothing when every row is clean", () => {
    const { container } = render(
      <CrmImportFixes rows={[row()]} overrides={[]} onCommitEdit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one input per flagged field", () => {
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
      warnings: [{ field: "primaryDob", message: "isn't a date we can read" }],
    });
    render(<CrmImportFixes rows={[flagged]} overrides={[]} onCommitEdit={vi.fn()} />);
    expect(screen.getByLabelText(/primary last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary date of birth/i)).toBeInTheDocument();
    // Only the flagged fields get an input — an unflagged field (e.g. the
    // household name, never mentioned in errors/warnings above) must not.
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument();
  });

  it("emits an override on blur, not on every keystroke", () => {
    const onCommitEdit = vi.fn();
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
    });
    render(<CrmImportFixes rows={[flagged]} overrides={[]} onCommitEdit={onCommitEdit} />);
    const input = screen.getByLabelText(/primary last name/i);
    fireEvent.change(input, { target: { value: "Jones" } });
    expect(onCommitEdit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommitEdit).toHaveBeenCalledWith([
      { rowIndex: 0, field: "primaryLast", value: "Jones" },
    ]);
  });

  it("replaces an existing override for the same cell rather than appending", () => {
    const onCommitEdit = vi.fn();
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
    });
    render(
      <CrmImportFixes
        rows={[flagged]}
        overrides={[{ rowIndex: 0, field: "primaryLast", value: "Old" }]}
        onCommitEdit={onCommitEdit}
      />,
    );
    const input = screen.getByLabelText(/primary last name/i);
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.blur(input);
    expect(onCommitEdit).toHaveBeenCalledWith([
      { rowIndex: 0, field: "primaryLast", value: "New" },
    ]);
  });

  it("keeps another field's override untouched when only one field is edited", () => {
    const onCommitEdit = vi.fn();
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
      warnings: [{ field: "primaryDob", message: "isn't a date we can read" }],
    });
    render(
      <CrmImportFixes
        rows={[flagged]}
        overrides={[
          { rowIndex: 0, field: "primaryLast", value: "Old" },
          { rowIndex: 0, field: "primaryDob", value: "1970-01-01" },
        ]}
        onCommitEdit={onCommitEdit}
      />,
    );
    const lastInput = screen.getByLabelText(/primary last name/i);
    fireEvent.change(lastInput, { target: { value: "New" } });
    fireEvent.blur(lastInput);
    expect(onCommitEdit).toHaveBeenCalledWith([
      { rowIndex: 0, field: "primaryDob", value: "1970-01-01" },
      { rowIndex: 0, field: "primaryLast", value: "New" },
    ]);
  });

  it("clears an existing override when the input is blanked", () => {
    const onCommitEdit = vi.fn();
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
    });
    render(
      <CrmImportFixes
        rows={[flagged]}
        overrides={[{ rowIndex: 0, field: "primaryLast", value: "Old" }]}
        onCommitEdit={onCommitEdit}
      />,
    );
    const input = screen.getByLabelText(/primary last name/i);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommitEdit).toHaveBeenCalledWith([]);
  });

  it("does not commit when a field is blurred without ever being edited", () => {
    const onCommitEdit = vi.fn();
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
    });
    render(
      <CrmImportFixes
        rows={[flagged]}
        overrides={[{ rowIndex: 0, field: "primaryLast", value: "Smith" }]}
        onCommitEdit={onCommitEdit}
      />,
    );
    const input = screen.getByLabelText(/primary last name/i);
    input.focus();
    fireEvent.blur(input);
    expect(onCommitEdit).not.toHaveBeenCalled();
  });

  it("does not commit when the typed value matches the existing override", () => {
    const onCommitEdit = vi.fn();
    const flagged = row({
      errors: [{ field: "primaryLast", message: "Primary last name is required." }],
    });
    render(
      <CrmImportFixes
        rows={[flagged]}
        overrides={[{ rowIndex: 0, field: "primaryLast", value: "Smith" }]}
        onCommitEdit={onCommitEdit}
      />,
    );
    const input = screen.getByLabelText(/primary last name/i);
    // Type something different first, then back to the override's exact
    // value. Firing `change` straight to the value already on screen is a
    // no-op in React — it dedupes a same-value controlled input and never
    // calls onChange — which would leave `drafts` empty and accidentally
    // re-test "never typed into" instead of "typed value equals the
    // override." This two-step change genuinely populates the draft first.
    fireEvent.change(input, { target: { value: "Smithy" } });
    fireEvent.change(input, { target: { value: "Smith" } });
    fireEvent.blur(input);
    expect(onCommitEdit).not.toHaveBeenCalled();
  });

  it("separates rows that cannot import from rows that merely warn", () => {
    const bad = row({ rowIndex: 0, errors: [{ field: "primaryLast", message: "required" }] });
    const warn = row({ rowIndex: 1, warnings: [{ field: "state", message: "not a US state" }] });
    render(<CrmImportFixes rows={[bad, warn]} overrides={[]} onCommitEdit={vi.fn()} />);
    expect(screen.getByText(/won't import/i)).toBeInTheDocument();
    expect(screen.getByText(/will import/i)).toBeInTheDocument();
    // Both texts existing somewhere isn't enough — pin each label to its own
    // row, so a swapped label (still both texts present) would fail here.
    const badRow = screen.getByText(/^Row 1/).closest("div");
    const warnRow = screen.getByText(/^Row 2/).closest("div");
    expect(badRow).toHaveTextContent(/won't import/i);
    expect(warnRow).toHaveTextContent(/will import/i);
    expect(badRow).not.toHaveTextContent(/^will import/i);
    expect(warnRow).not.toHaveTextContent(/won't import/i);
  });
});

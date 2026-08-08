// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrmImportMapping } from "../crm-import-mapping";

const HEADER = ["Last Name", "First Name", "Notes column"];

describe("CrmImportMapping", () => {
  it("shows every importable field with its detected column selected", () => {
    render(
      <CrmImportMapping
        header={HEADER}
        mapping={{ primaryLast: 0, primaryFirst: 1 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/primary last name/i)).toHaveValue("0");
    expect(screen.getByLabelText(/primary first name/i)).toHaveValue("1");
    expect(screen.getByLabelText(/^city$/i)).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("emits the updated mapping when a column is chosen", () => {
    const onChange = vi.fn();
    render(
      <CrmImportMapping header={HEADER} mapping={{ primaryLast: 0 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith({ primaryLast: 0, notes: 2 });
  });

  it("emits a mapping with the field removed when set to not imported", () => {
    const onChange = vi.fn();
    render(
      <CrmImportMapping header={HEADER} mapping={{ primaryLast: 0 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/primary last name/i), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({});
    // toHaveBeenCalledWith ignores undefined-valued keys, so `{}` alone can't
    // tell `delete mapping.primaryLast` from `mapping.primaryLast = undefined`
    // — pin that the key is actually absent, not just undefined.
    const emitted = onChange.mock.calls[0][0];
    expect("primaryLast" in emitted).toBe(false);
  });

  it("warns when a required field has no column", () => {
    render(<CrmImportMapping header={HEADER} mapping={{}} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/first name/i);
  });
});

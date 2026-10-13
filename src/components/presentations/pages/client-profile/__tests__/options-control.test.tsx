// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClientProfileOptionsControl } from "../options-control";
import type { ClientProfilePageOptions } from "@/lib/presentations/pages/client-profile/types";

function renderControl(value: unknown) {
  const onChange = vi.fn();
  render(<ClientProfileOptionsControl value={value as ClientProfilePageOptions} onChange={onChange} />);
  return onChange;
}

describe("ClientProfileOptionsControl", () => {
  it("opens a legacy `{}` deck on Current and Retirement", () => {
    renderControl({});
    expect((screen.getByLabelText("Expense column 1") as HTMLSelectElement).value).toBe("current");
    expect((screen.getByLabelText("Expense column 2") as HTMLSelectElement).value).toBe("retirement");
  });

  it("switches a column to years from now and sets the count", () => {
    const onChange = renderControl({});
    fireEvent.change(screen.getByLabelText("Expense column 2"), { target: { value: "yearsFromNow" } });
    expect(onChange).toHaveBeenLastCalledWith({
      expenseColumns: [{ kind: "current" }, { kind: "yearsFromNow", years: 5 }],
    });
  });

  it("edits the years and ignores an emptied field", () => {
    const onChange = renderControl({ expenseColumns: [{ kind: "current" }, { kind: "yearsFromNow", years: 5 }] });
    const years = screen.getByLabelText("Expense column 2, years from now");
    fireEvent.change(years, { target: { value: "4" } });
    expect(onChange).toHaveBeenLastCalledWith({
      expenseColumns: [{ kind: "current" }, { kind: "yearsFromNow", years: 4 }],
    });
    onChange.mockClear();
    fireEvent.change(years, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds up to four columns and removes one", () => {
    const four: ClientProfilePageOptions = {
      expenseColumns: [{ kind: "current" }, { kind: "retirement" }, { kind: "current" }, { kind: "retirement" }],
    };
    const onChange = renderControl(four);
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Remove expense column 1"));
    expect(onChange).toHaveBeenLastCalledWith({ expenseColumns: four.expenseColumns.slice(1) });
  });

  it("offers no Remove when only one column is left", () => {
    renderControl({ expenseColumns: [{ kind: "current" }] });
    expect(screen.queryByLabelText("Remove expense column 1")).toBeNull();
  });
});

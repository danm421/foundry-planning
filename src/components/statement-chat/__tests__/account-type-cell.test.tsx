// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountTypeCellEdit from "../account-type-cell";

/**
 * Task 10 review, Important 2: category + sub-type must change together —
 * neither select may fire `onDone` on its own, or a reclassification into
 * (or out of) a 529 applies half the change and the editor closes having
 * lost the other half.
 */
describe("account type cell edit", () => {
  it("does not call onDone when only one dropdown has changed", async () => {
    const onDone = vi.fn();
    render(<AccountTypeCellEdit category="taxable" subType="brokerage" onDone={onDone} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "retirement");
    expect(onDone).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Type"), "roth_ira");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls onDone once, with both values together, only when Done is clicked", async () => {
    const onDone = vi.fn();
    render(<AccountTypeCellEdit category="taxable" subType="brokerage" onDone={onDone} />);

    await userEvent.selectOptions(screen.getByLabelText("Category"), "retirement");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "roth_ira");
    await userEvent.click(screen.getByRole("button", { name: /done/i }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ category: "retirement", subType: "roth_ira" });
  });
});

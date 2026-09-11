// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OwnerCellEdit from "../owner-cell-edit";

/**
 * Fix round 1, Minor 5. `tools.ts`'s `isValidFieldValue` accepts exactly
 * "client", "spouse" and "joint" for `owner`, and staying inside that domain
 * is the whole point of the control writing on change: an `undefined` or `""`
 * would be rejected downstream, so the editor must not be able to produce
 * one. Nothing pinned that until these tests.
 */
describe("owner cell edit", () => {
  it("offers the three roles and a placeholder that cannot be chosen", () => {
    render(<OwnerCellEdit onDone={vi.fn()} />);
    const select = screen.getByLabelText("Owner");
    expect(screen.getByRole("option", { name: "Select..." })).toBeDisabled();
    expect(
      [...select.querySelectorAll("option")].filter((o) => !o.disabled).map((o) => o.value),
    ).toEqual(["client", "spouse", "joint"]);
  });

  it("never reports an empty value, even if a change event carries one", () => {
    const onDone = vi.fn();
    render(<OwnerCellEdit owner="client" onDone={onDone} />);
    // The placeholder is `disabled`, so a user cannot reach this — but the
    // guard behind it is what keeps a stray change event from writing `""`
    // into a field whose domain check would then reject it.
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "" } });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports the picked role once", async () => {
    const onDone = vi.fn();
    render(<OwnerCellEdit onDone={onDone} />);
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "joint");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("joint");
  });

  it("shows the registration name and why it is only an assumption", () => {
    render(<OwnerCellEdit hint="JULIA B. SAMPLE" onDone={vi.fn()} />);
    expect(screen.getByText(/JULIA B. SAMPLE/)).toBeInTheDocument();
    expect(screen.getByText(/not yet matched to a family member/i)).toBeInTheDocument();
  });
});

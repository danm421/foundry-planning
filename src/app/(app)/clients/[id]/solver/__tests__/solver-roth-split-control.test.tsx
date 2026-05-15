// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RothSplitControl } from "../solver-roth-split-control";

describe("RothSplitControl", () => {
  it("shows the Pre-tax/Roth toggle when the rule is whole pre-tax", () => {
    render(<RothSplitControl rothPercent={0} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pre-tax" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roth" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Roth %")).not.toBeInTheDocument();
  });

  it("treats null rothPercent as fully pre-tax", () => {
    render(<RothSplitControl rothPercent={null} onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Pre-tax" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking Roth emits a fraction of 1", async () => {
    const onChange = vi.fn();
    render(<RothSplitControl rothPercent={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Roth" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("clicking Pre-tax emits a fraction of 0", async () => {
    const onChange = vi.fn();
    render(<RothSplitControl rothPercent={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Pre-tax" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("renders complementary split inputs when partially Roth", () => {
    render(<RothSplitControl rothPercent={0.4} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Pre-tax %")).toHaveValue(60);
    expect(screen.getByLabelText("Roth %")).toHaveValue(40);
  });

  it("editing the Roth split input emits roth/100", async () => {
    const onChange = vi.fn();
    render(<RothSplitControl rothPercent={0.4} onChange={onChange} />);
    const rothInput = screen.getByLabelText("Roth %");
    await userEvent.clear(rothInput);
    await userEvent.type(rothInput, "30");
    expect(onChange).toHaveBeenLastCalledWith(0.3);
  });

  it("editing the Pre-tax split input emits the complementary roth fraction", async () => {
    const onChange = vi.fn();
    render(<RothSplitControl rothPercent={0.4} onChange={onChange} />);
    const pretaxInput = screen.getByLabelText("Pre-tax %");
    await userEvent.clear(pretaxInput);
    await userEvent.type(pretaxInput, "90");
    expect(onChange).toHaveBeenLastCalledWith(0.1);
  });

  it("clearing a split input does not call onChange (prevents mid-edit collapse)", async () => {
    const onChange = vi.fn();
    render(<RothSplitControl rothPercent={0.4} onChange={onChange} />);
    const rothInput = screen.getByLabelText("Roth %");
    // Select-all + delete — leaves the field empty without typing a digit
    await userEvent.clear(rothInput);
    // onChange must NOT have been called at all (the empty-string state should be buffered)
    expect(onChange).not.toHaveBeenCalled();
  });

  it("typing an explicit '0' in the Roth split input still emits onChange(0) (collapse is intentional)", async () => {
    const onChange = vi.fn();
    render(<RothSplitControl rothPercent={0.4} onChange={onChange} />);
    const rothInput = screen.getByLabelText("Roth %");
    await userEvent.clear(rothInput);
    await userEvent.type(rothInput, "0");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});

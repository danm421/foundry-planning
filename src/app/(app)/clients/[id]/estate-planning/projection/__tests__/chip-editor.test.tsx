// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipEditor } from "../chip-editor";

describe("ChipEditor", () => {
  it("calls onSave with new value and dismisses", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <ChipEditor
        label="Growth %"
        currentValue={0.07}
        format="pct"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "0.08");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(0.08);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancel dismisses without calling onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <ChipEditor
        label="Inflation %"
        currentValue={0.03}
        format="pct"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects invalid input (non-numeric) and shows inline error", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <ChipEditor
        label="Plan end year"
        currentValue={2080}
        format="year"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    // type=number filters non-numeric chars; clearing leaves an empty string
    // which our validator treats as "Enter a number".
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/enter a number/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

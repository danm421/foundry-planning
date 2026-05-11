// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CustomizeToolbar } from "../customize-toolbar";

describe("CustomizeToolbar", () => {
  it("calls onAddText when Add text block clicked", () => {
    const onAddText = vi.fn();
    const { getByText } = render(
      <CustomizeToolbar
        onAddText={onAddText}
        onReset={vi.fn()}
        onDone={vi.fn()}
        saving={false}
      />,
    );
    fireEvent.click(getByText("+ Add text block"));
    expect(onAddText).toHaveBeenCalled();
  });

  it("calls onReset when Reset clicked", () => {
    const onReset = vi.fn();
    const { getByText } = render(
      <CustomizeToolbar
        onAddText={vi.fn()}
        onReset={onReset}
        onDone={vi.fn()}
        saving={false}
      />,
    );
    fireEvent.click(getByText("Reset to default"));
    expect(onReset).toHaveBeenCalled();
  });

  it("calls onDone when Done clicked", () => {
    const onDone = vi.fn();
    const { getByText } = render(
      <CustomizeToolbar
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onDone={onDone}
        saving={false}
      />,
    );
    fireEvent.click(getByText("Done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("disables Done while saving", () => {
    const { getByText } = render(
      <CustomizeToolbar
        onAddText={vi.fn()}
        onReset={vi.fn()}
        onDone={vi.fn()}
        saving
      />,
    );
    expect((getByText("Saving…") as HTMLButtonElement).disabled).toBe(true);
  });
});

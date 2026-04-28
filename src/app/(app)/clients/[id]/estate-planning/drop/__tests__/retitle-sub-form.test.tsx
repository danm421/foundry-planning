// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { RetitleSubForm } from "@/app/(app)/clients/[id]/estate-planning/drop/retitle-sub-form";

const baseProps = {
  ownerSlicePct: 0.6,
  recipientKind: "entity" as const,
};

describe("RetitleSubForm", () => {
  it("emits sliceFraction = percent / 100 on submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RetitleSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const percent = screen.getByLabelText(/percent of/i);
    await user.clear(percent);
    await user.type(percent, "40");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith({ sliceFraction: 0.4 });
  });

  it("renders the helper note 'No gift event recorded.'", () => {
    render(
      <RetitleSubForm
        {...baseProps}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/no gift event recorded/i)).toBeInTheDocument();
  });

  it("rejects 0% (does not submit)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RetitleSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const percent = screen.getByLabelText(/percent of/i);
    await user.clear(percent);
    await user.type(percent, "0");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects >100% (does not submit)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RetitleSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const percent = screen.getByLabelText(/percent of/i);
    await user.clear(percent);
    await user.type(percent, "150");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <RetitleSubForm
        {...baseProps}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

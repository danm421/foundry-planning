// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { BequestSubForm } from "@/app/(app)/clients/[id]/estate-planning/drop/bequest-sub-form";

const baseProps = {
  ownerSlicePct: 1,
  isJointOrFractional: false,
  spouseAvailable: true,
  recipientKind: "entity" as const,
};

describe("BequestSubForm", () => {
  it("forces condition='if_spouse_predeceased' and disables others when isJointOrFractional", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestSubForm
        {...baseProps}
        isJointOrFractional
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const always = screen.getByLabelText(/always/i);
    const ifSurvives = screen.getByLabelText(/if spouse survives/i);
    const ifPredeceased = screen.getByLabelText(/if spouse predeceased/i);

    expect(always).toBeDisabled();
    expect(ifSurvives).toBeDisabled();
    expect(ifPredeceased).toBeChecked();

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ condition: "if_spouse_predeceased" }),
    );
  });

  it("hides whose-will radios when !spouseAvailable (defaults grantorMode to 'client')", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestSubForm
        {...baseProps}
        spouseAvailable={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/spouse's will/i)).toBeNull();
    expect(screen.queryByLabelText(/both \(mirror\)/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ grantorMode: "client" }),
    );
  });

  it("on submit emits grantorMode='both' when 'Both (mirror)' selected", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText(/both \(mirror\)/i));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ grantorMode: "both" }),
    );
  });

  it("rejects sliceFraction <= 0 (does not submit)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestSubForm
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

  it("rejects sliceFraction > 1 (does not submit)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestSubForm
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

  it("emits sliceFraction = percent / 100 on a normal submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BequestSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const percent = screen.getByLabelText(/percent of/i);
    await user.clear(percent);
    await user.type(percent, "75");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sliceFraction: 0.75 }),
    );
  });
});

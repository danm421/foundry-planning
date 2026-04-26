// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TrustDropChooser } from "@/app/(app)/clients/[id]/estate-planning/popovers/trust-drop-chooser";

describe("TrustDropChooser", () => {
  it("renders all 6 options with the correct labels", () => {
    render(
      <TrustDropChooser
        anchor={{ clientX: 100, clientY: 100 }}
        assetName="Brokerage A"
        trustName="Family ILIT"
        clientFirstName="Tom"
        spouseFirstName="Linda"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /already owned/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /gift this year/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /gift in a future year/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /recurring annual gift/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /bequest at tom/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /bequest at linda/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /sale to trust/i })).toBeDisabled();
  });

  it("invokes onSelect with the picked option", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <TrustDropChooser
        anchor={{ clientX: 100, clientY: 100 }}
        assetName="Brokerage A"
        trustName="Family ILIT"
        clientFirstName="Tom"
        spouseFirstName="Linda"
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /gift this year/i }));
    expect(onSelect).toHaveBeenCalledWith("gift_this_year");
  });

  it("invokes onCancel when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <TrustDropChooser
        anchor={{ clientX: 100, clientY: 100 }}
        assetName="Brokerage A"
        trustName="Family ILIT"
        clientFirstName="Tom"
        spouseFirstName="Linda"
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByTestId("trust-drop-chooser-backdrop"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

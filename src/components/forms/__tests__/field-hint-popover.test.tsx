// @vitest-environment jsdom
// src/components/forms/__tests__/field-hint-popover.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldHintPopover } from "../field-hint-popover";

describe("FieldHintPopover", () => {
  it("renders nothing when there are no rows", () => {
    const { container } = render(<FieldHintPopover label="x" rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes the badge with its accessible label", () => {
    render(<FieldHintPopover label="Living expenses details" rows={[{ term: "Growth", value: "2.40%" }]} />);
    expect(screen.getByRole("button", { name: "Living expenses details" })).toBeInTheDocument();
  });

  it("opens the tooltip on focus and shows term + value", async () => {
    render(
      <FieldHintPopover
        label="Living expenses details"
        rows={[
          { term: "Growth", value: "2.40%" },
          { value: "after-tax" },
        ]}
      />,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    screen.getByRole("button", { name: "Living expenses details" }).focus();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Growth");
    expect(tip).toHaveTextContent("2.40%");
    expect(tip).toHaveTextContent("after-tax");
  });

  it("closes the tooltip on Escape", async () => {
    const user = userEvent.setup();
    render(<FieldHintPopover label="Details" rows={[{ term: "Growth", value: "2.40%" }]} />);
    screen.getByRole("button", { name: "Details" }).focus();
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClutFundingPicker, {
  type ClutFundingPickerAccount,
} from "../clut-funding-picker";
import type { ClutFundingPick } from "@/lib/forms/clut-funding-diff";

const accounts: ClutFundingPickerAccount[] = [
  { id: "a1", name: "Schwab Brokerage", subType: "Taxable", ownerSummary: "Client 100%", value: 850_000 },
  { id: "a2", name: "Joint Vanguard", subType: "Taxable", ownerSummary: "Joint 50/50", value: 600_000 },
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof ClutFundingPicker>> = {}) {
  const onChange = vi.fn();
  const result = render(
    <ClutFundingPicker
      accounts={accounts}
      picks={[]}
      inceptionValue={0}
      defaultGrantor="client"
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange, ...result };
}

describe("<ClutFundingPicker>", () => {
  it("renders a closed disclosure trigger with the empty placeholder", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: /select assets to fund the trust/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("opens the popover with one row per account when clicked", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /select assets/i }));
    expect(screen.getByRole("button", { name: /select assets/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const rows = screen.getAllByRole("checkbox");
    // 2 accounts + 1 cash row = 3
    expect(rows).toHaveLength(3);
    expect(screen.getByText("Schwab Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Joint Vanguard")).toBeInTheDocument();
  });

  it("calls onChange with a new asset pick (default 100%) when the checkbox is ticked", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /select assets/i }));
    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox = first account (Schwab Brokerage)
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith([
      { kind: "asset", accountId: "a1", percent: 1.0 },
    ]);
  });

  it("calls onChange with cash pick (default amount 0, default grantor) when cash row is ticked", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /select assets/i }));
    const checkboxes = screen.getAllByRole("checkbox");
    // Cash row is the last checkbox
    fireEvent.click(checkboxes[checkboxes.length - 1]);
    expect(onChange).toHaveBeenCalledWith([
      { kind: "cash", grantor: "client", amount: 0 },
    ]);
  });

  it("shows the count + total in the closed trigger when picks exist", () => {
    const picks: ClutFundingPick[] = [
      { kind: "asset", accountId: "a1", percent: 1.0 },
      { kind: "cash", grantor: "client", amount: 50_000 },
    ];
    renderPicker({ picks, inceptionValue: 900_000 });
    expect(
      screen.getByRole("button", { name: /2 rows · \$900K/ }),
    ).toBeInTheDocument();
  });

  it("closes the popover when Escape is pressed", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /select assets/i }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("calls onChange with the pick removed when an already-checked asset is unticked", () => {
    const picks: ClutFundingPick[] = [
      { kind: "asset", accountId: "a1", percent: 1.0 },
    ];
    const { onChange } = renderPicker({ picks });
    fireEvent.click(screen.getByRole("button", { name: /1 row/i }));
    // First checkbox is the now-checked Schwab Brokerage; unticking it removes the pick.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

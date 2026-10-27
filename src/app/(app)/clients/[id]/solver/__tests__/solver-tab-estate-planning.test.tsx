// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstateGiftsList } from "../solver-tab-estate-planning";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const baseGift: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2029, amount: 10000, grantor: "client",
  recipient: { kind: "family_member", id: "f0" }, crummey: false,
};
const draftGift: EstateFlowGift = {
  kind: "cash-once", id: "d1", year: 2030, amount: 25000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function renderGifts(over: {
  gifts?: EstateFlowGift[];
  baseGiftIds?: Set<string>;
  onToggle?: (g: EstateFlowGift) => void;
  onEdit?: (g: EstateFlowGift) => void;
  onRemove?: (id: string) => void;
} = {}) {
  render(
    <EstateGiftsList
      gifts={[baseGift, draftGift]}
      baseGiftIds={new Set(["g1"])}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
      {...over}
    />,
  );
}

describe("EstateGiftsList", () => {
  it("shows gifts with badges and remove controls", () => {
    renderGifts();
    expect(screen.getByText("Base plan")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getAllByText("Remove")).toHaveLength(2);
  });

  it("shows an empty state when there are no gifts at all", () => {
    renderGifts({ gifts: [], baseGiftIds: new Set() });
    expect(screen.getByText("No planned gifts")).toBeTruthy();
  });
});

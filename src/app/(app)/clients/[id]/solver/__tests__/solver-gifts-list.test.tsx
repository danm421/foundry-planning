// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { EstateGiftsList } from "../solver-tab-estate-planning";

const baseGift: EstateFlowGift = { kind: "cash-once", id: "base-g", year: 2030, amount: 10000, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false };
const addedGift: EstateFlowGift = { kind: "cash-once", id: "new-g", year: 2031, amount: 5000, grantor: "client", recipient: { kind: "entity", id: "t1" }, crummey: false };

it("renders base + added gifts with badges and wires the controls", () => {
  const onToggle = vi.fn(), onEdit = vi.fn(), onRemove = vi.fn();
  render(
    <EstateGiftsList
      gifts={[baseGift, addedGift]}
      baseGiftIds={new Set(["base-g"])}
      onToggle={onToggle}
      onEdit={onEdit}
      onRemove={onRemove}
    />,
  );
  expect(screen.getByText("Base plan")).toBeInTheDocument();
  expect(screen.getByText("Added")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("switch")[0]);
  expect(onToggle).toHaveBeenCalledWith(baseGift);
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BuyLegEditor from "../asset-transaction-buy-leg";
import { emptyBuyLeg } from "../asset-transaction-leg-model";

describe("BuyLegEditor", () => {
  it("resets sub-type when category changes", () => {
    const onChange = vi.fn();
    render(<BuyLegEditor leg={emptyBuyLeg("b")} onChange={onChange} accounts={[]} />);
    fireEvent.change(screen.getByLabelText(/Asset Category/i), { target: { value: "business" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ assetCategory: "business", assetSubType: "sole_proprietorship" }),
    );
  });
});

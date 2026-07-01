// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { useSolverEstateEditor } from "../use-solver-estate-editor";

const planSettings = {
  planStartYear: 2026,
  planEndYear: 2060,
  inflationRate: 0.025,
  taxInflationRate: 0.025,
};

function clientData(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { spouseDob: null },
    accounts: [],
    entities: [],
    externalBeneficiaries: [],
    incomes: [],
    expenses: {},
    savingsRules: [],
    liabilities: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    planSettings,
    ...over,
  } as unknown as ClientData;
}

const gift: EstateFlowGift = {
  kind: "cash-once", id: "g1", year: 2030, amount: 10000, grantor: "client",
  recipient: { kind: "family_member", id: "f1" }, crummey: false,
};

function setup(over: { baseGifts?: EstateFlowGift[] } = {}) {
  const onChange = vi.fn();
  const base = clientData();
  const view = renderHook(() =>
    useSolverEstateEditor({
      baseClientData: base,
      clientData: base,
      baseGifts: over.baseGifts ?? [],
      onChange,
    }),
  );
  return { onChange, view };
}

describe("useSolverEstateEditor", () => {
  it("reports an empty summary when nothing is configured", () => {
    const { view } = setup();
    expect(view.result.current.summary.isEmpty).toBe(true);
    expect(view.result.current.summary.giftCount).toBe(0);
  });

  it("counts an active base gift and drops it from the count when toggled off", () => {
    const { view, onChange } = setup({ baseGifts: [gift] });
    expect(view.result.current.summary.giftCount).toBe(1);
    expect(view.result.current.summary.isEmpty).toBe(false);

    act(() => view.result.current.toggleGift(gift));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "gift-upsert", id: "g1" }),
    );
    expect(view.result.current.summary.giftCount).toBe(0);
  });
});

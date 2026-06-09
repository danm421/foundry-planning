// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import type { EntityPickerOption } from "@/lib/presentations/entity-picker-options";
import { EntityCashFlowOptionsControl } from "../options-control";
import { ENTITY_CASH_FLOW_OPTIONS_DEFAULT, type EntityCashFlowPageOptions } from "../types";

const entities: EntityPickerOption[] = [
  { id: "t1", name: "Smith Family Trust", entityType: "trust" },
  { id: "b1", name: "ABC Holdings LLC", entityType: "llc" },
];

function wrap(ui: React.ReactNode, ents: EntityPickerOption[] = entities) {
  return render(
    <PresentationOptionsProvider
      value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios: [], clientId: "c1", entities: ents }}
    >
      {ui}
    </PresentationOptionsProvider>,
  );
}

describe("EntityCashFlowOptionsControl", () => {
  it("auto-selects the first entity on mount when none is chosen", () => {
    const onChange = vi.fn();
    wrap(<EntityCashFlowOptionsControl value={ENTITY_CASH_FLOW_OPTIONS_DEFAULT} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "t1", entityName: "Smith Family Trust" }),
    );
  });

  it("writes both id and name when the advisor picks a different entity", () => {
    const onChange = vi.fn();
    const value: EntityCashFlowPageOptions = { entityId: "t1", entityName: "Smith Family Trust", range: "full" };
    const { getByLabelText } = wrap(<EntityCashFlowOptionsControl value={value} onChange={onChange} />);
    fireEvent.change(getByLabelText("Entity"), { target: { value: "b1" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "b1", entityName: "ABC Holdings LLC" }),
    );
  });

  it("shows an empty-state note when there are no entities", () => {
    const { getByText } = wrap(
      <EntityCashFlowOptionsControl value={ENTITY_CASH_FLOW_OPTIONS_DEFAULT} onChange={vi.fn()} />,
      [],
    );
    expect(getByText("No trusts or businesses on file.")).toBeTruthy();
  });
});

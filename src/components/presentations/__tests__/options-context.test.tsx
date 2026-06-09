// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import { PresentationOptionsProvider, useEntityOptions } from "../options-context";

describe("useEntityOptions", () => {
  it("defaults to [] with no provider", () => {
    const { result } = renderHook(() => useEntityOptions());
    expect(result.current).toEqual([]);
  });

  it("returns the entities supplied by the provider", () => {
    const entities = [{ id: "t1", name: "Smith Family Trust", entityType: "trust" }];
    const { result } = renderHook(() => useEntityOptions(), {
      wrapper: ({ children }) => (
        <PresentationOptionsProvider
          value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios: [], clientId: "c1", entities }}
        >
          {children}
        </PresentationOptionsProvider>
      ),
    });
    expect(result.current).toEqual(entities);
  });
});

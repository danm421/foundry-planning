import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("entityCashFlow presentation page", () => {
  it("is registered in the Cash Flow category", () => {
    const page = PRESENTATION_PAGES.entityCashFlow;
    expect(page).toBeDefined();
    expect(page.id).toBe("entityCashFlow");
    expect(page.title).toBe("Business & Trusts");
    expect(page.category).toBe("Cash Flow");
    expect(typeof page.OptionsControl).toBe("function");
  });

  it("starts with an empty selection in its defaults", () => {
    expect(PRESENTATION_PAGES.entityCashFlow.defaultOptions).toEqual({
      entityId: "",
      entityName: "",
      range: "full",
    });
  });
});

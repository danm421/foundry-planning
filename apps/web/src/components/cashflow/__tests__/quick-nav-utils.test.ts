import { describe, it, expect } from "vitest";
import {
  activeViewFromDrillPath,
  drillPathForView,
  viewFromSearchParam,
  searchParamForView,
} from "../quick-nav-utils";

describe("activeViewFromDrillPath", () => {
  it("returns 'base' for an empty drillPath", () => {
    expect(activeViewFromDrillPath([])).toBe("base");
  });

  it("returns 'income' when drillPath[0] is 'income'", () => {
    expect(activeViewFromDrillPath(["income"])).toBe("income");
    expect(activeViewFromDrillPath(["income", "detail"])).toBe("income");
  });

  it("returns 'expenses' when drillPath[0] is 'expenses'", () => {
    expect(activeViewFromDrillPath(["expenses"])).toBe("expenses");
    expect(activeViewFromDrillPath(["expenses", "detail"])).toBe("expenses");
  });

  it("returns 'withdrawals' when drillPath[0] is 'cashflow'", () => {
    expect(activeViewFromDrillPath(["cashflow"])).toBe("withdrawals");
    expect(activeViewFromDrillPath(["cashflow", "detail"])).toBe("withdrawals");
  });

  it("returns 'assets' when drillPath[0] is 'portfolio'", () => {
    expect(activeViewFromDrillPath(["portfolio"])).toBe("assets");
    expect(activeViewFromDrillPath(["portfolio", "growth"])).toBe("assets");
  });

  it("returns 'base' for sub-drills of base (savings, growth, activity, other_income_detail)", () => {
    expect(activeViewFromDrillPath(["savings"])).toBe("base");
    expect(activeViewFromDrillPath(["growth"])).toBe("base");
    expect(activeViewFromDrillPath(["activity"])).toBe("base");
    expect(activeViewFromDrillPath(["other_income_detail"])).toBe("base");
  });

  it("returns 'base' for any unknown top segment", () => {
    expect(activeViewFromDrillPath(["something-else"])).toBe("base");
  });
});

describe("drillPathForView", () => {
  it("maps 'base' to []", () => {
    expect(drillPathForView("base")).toEqual([]);
  });

  it("maps 'income' to ['income']", () => {
    expect(drillPathForView("income")).toEqual(["income"]);
  });

  it("maps 'expenses' to ['expenses']", () => {
    expect(drillPathForView("expenses")).toEqual(["expenses"]);
  });

  it("maps 'withdrawals' to ['cashflow']", () => {
    expect(drillPathForView("withdrawals")).toEqual(["cashflow"]);
  });

  it("maps 'assets' to ['portfolio']", () => {
    expect(drillPathForView("assets")).toEqual(["portfolio"]);
  });
});

describe("viewFromSearchParam", () => {
  it("returns 'base' for null", () => {
    expect(viewFromSearchParam(null)).toBe("base");
  });

  it("returns 'income' for 'income'", () => {
    expect(viewFromSearchParam("income")).toBe("income");
  });

  it("returns 'expenses' for 'expenses'", () => {
    expect(viewFromSearchParam("expenses")).toBe("expenses");
  });

  it("returns 'withdrawals' for 'withdrawals'", () => {
    expect(viewFromSearchParam("withdrawals")).toBe("withdrawals");
  });

  it("returns 'assets' for 'assets'", () => {
    expect(viewFromSearchParam("assets")).toBe("assets");
  });

  it("returns 'base' for unknown or malformed values", () => {
    expect(viewFromSearchParam("")).toBe("base");
    expect(viewFromSearchParam("taxes")).toBe("base");
    expect(viewFromSearchParam("foo")).toBe("base");
    expect(viewFromSearchParam("WITHDRAWALS")).toBe("base"); // case-sensitive by design
  });
});

describe("searchParamForView", () => {
  it("returns null for 'base' (no param in URL)", () => {
    expect(searchParamForView("base")).toBeNull();
  });

  it("returns 'income' for 'income'", () => {
    expect(searchParamForView("income")).toBe("income");
  });

  it("returns 'expenses' for 'expenses'", () => {
    expect(searchParamForView("expenses")).toBe("expenses");
  });

  it("returns 'withdrawals' for 'withdrawals'", () => {
    expect(searchParamForView("withdrawals")).toBe("withdrawals");
  });

  it("returns 'assets' for 'assets'", () => {
    expect(searchParamForView("assets")).toBe("assets");
  });
});

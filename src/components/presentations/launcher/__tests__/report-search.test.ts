import { describe, it, expect } from "vitest";
import { searchReports } from "../report-search";

describe("searchReports", () => {
  it("empty query: no recents → categories in CATEGORY_ORDER, Framing first", () => {
    const result = searchReports("", {}, []);
    expect(result.sections[0].heading).toBe("Framing");
    expect(result.sections[1].heading).toBe("Cash Flow");
    expect(result.sections.some((s) => s.heading === "Recently added")).toBe(false);
  });

  it("empty query with recents puts a Recently added section first", () => {
    const result = searchReports("", {}, ["cashFlowAssets"]);
    expect(result.sections[0].heading).toBe("Recently added");
    expect(result.sections[0].rows[0].id).toBe("cashFlowAssets");
  });

  it("ranks a title match above a description-only match", () => {
    const result = searchReports("income", {}, []);
    // "Cash Flow — Income" matches in its title (rank 1); the plain "Cash Flow"
    // page matches "income" only in its description (rank 2) — titled wins.
    const titled = result.order.indexOf("cashFlowIncome");
    const descOnly = result.order.indexOf("cashFlow");
    expect(titled).toBeGreaterThanOrEqual(0);
    expect(descOnly).toBeGreaterThan(titled);
  });

  it("groups income-tax pages under their own Income Tax category", () => {
    const result = searchReports("income", {}, []);
    const headings = result.sections.map((s) => s.heading);
    expect(headings).toContain("Cash Flow");
    expect(headings).toContain("Income Tax");
    const incomeTax = result.sections.find((s) => s.heading === "Income Tax");
    // All begin "Income Tax —" (rank-0 title prefix), sorted alphabetically.
    expect(incomeTax?.rows[0].id).toBe("incomeTaxAboveLine");
  });

  it("activeCategory filter restricts results and drops recents", () => {
    const result = searchReports("", {}, ["cashFlow"], "Income Tax");
    expect(result.sections.every((s) => s.heading === "Income Tax")).toBe(true);
    expect(result.sections.some((s) => s.heading === "Recently added")).toBe(false);
    expect(result.order).toContain("incomeTaxIncome");
    expect(result.order).not.toContain("cashFlow");
  });

  it("empty placeholder category yields no sections", () => {
    expect(searchReports("", {}, [], "Retirement").sections).toHaveLength(0);
    expect(searchReports("", {}, [], "Retirement").order).toHaveLength(0);
  });

  it("the Comparison category surfaces the scenario-changes report", () => {
    expect(searchReports("", {}, [], "Comparison").order).toContain("scenarioChanges");
  });

  it("reflects deck counts on rows", () => {
    const result = searchReports("", { cashFlow: 2 }, []);
    const rows = result.sections.flatMap((s) => s.rows);
    expect(rows.find((r) => r.id === "cashFlow")?.count).toBe(2);
  });

  it("no match → empty sections and empty order", () => {
    const result = searchReports("zzzznotareport", {}, []);
    expect(result.sections).toHaveLength(0);
    expect(result.order).toHaveLength(0);
  });

  it("order is the flattened row ids in render order", () => {
    const result = searchReports("", {}, []);
    const flattened = result.sections.flatMap((s) => s.rows.map((r) => r.id));
    expect(result.order).toEqual(flattened);
  });

  it("whitespace-only query behaves like an empty query", () => {
    const ws = searchReports("   ", {}, []);
    const empty = searchReports("", {}, []);
    expect(ws.order).toEqual(empty.order);
  });

  it("does not duplicate a recent id in its category section", () => {
    const result = searchReports("", {}, ["cashFlow"]);
    // appears in Recently added...
    expect(result.sections[0].heading).toBe("Recently added");
    expect(result.sections[0].rows.some((r) => r.id === "cashFlow")).toBe(true);
    // ...and NOT again in the Cash Flow category
    const cashFlowCategory = result.sections.find(
      (s, i) => i > 0 && s.heading === "Cash Flow",
    );
    expect(cashFlowCategory?.rows.some((r) => r.id === "cashFlow")).toBe(false);
  });

  it("empty-query order has no duplicate ids, even with recents", () => {
    const result = searchReports("", {}, ["cashFlow", "cover"]);
    expect(new Set(result.order).size).toBe(result.order.length);
  });
});

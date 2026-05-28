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
    expect(result.order[0]).toBe("cashFlowIncome");
    expect(result.sections.every((s) => s.heading === "Cash Flow")).toBe(true);
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

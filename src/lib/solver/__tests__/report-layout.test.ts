import { describe, it, expect } from "vitest";
import {
  REPORT_KEYS,
  resolveReportLayout,
  visibleReportsInOrder,
  firstVisibleReport,
  isReportVisible,
  resolveActiveReport,
  type ReportLayoutEntry,
} from "../report-layout";

describe("resolveReportLayout", () => {
  it("null/empty → canonical order, all visible", () => {
    const out = resolveReportLayout(null);
    expect(out.map((e) => e.id)).toEqual([...REPORT_KEYS]);
    expect(out.every((e) => e.visible)).toBe(true);
  });

  it("preserves stored order and visibility for known ids", () => {
    const stored = [
      { id: "monteCarlo", visible: true },
      { id: "portfolio", visible: false },
      { id: "cashflow", visible: true },
    ];
    const out = resolveReportLayout(stored);
    // stored ids first, in stored order...
    expect(out.slice(0, 3).map((e) => e.id)).toEqual([
      "monteCarlo",
      "portfolio",
      "cashflow",
    ]);
    expect(out.find((e) => e.id === "portfolio")!.visible).toBe(false);
  });

  it("appends newly-shipped canonical ids at the end, visible", () => {
    const stored = [{ id: "portfolio", visible: true }];
    const out = resolveReportLayout(stored);
    expect(out).toHaveLength(REPORT_KEYS.length);
    // everything except portfolio is appended and visible
    for (const e of out) {
      if (e.id !== "portfolio") expect(e.visible).toBe(true);
    }
    expect(out[0].id).toBe("portfolio");
  });

  it("drops unknown ids and de-dupes", () => {
    const stored = [
      { id: "ghostReport", visible: true },
      { id: "estate", visible: false },
      { id: "estate", visible: true },
    ];
    const out = resolveReportLayout(stored);
    expect(out.filter((e) => e.id === "estate")).toHaveLength(1);
    expect(out.some((e) => (e.id as string) === "ghostReport")).toBe(false);
    // first-seen estate (visible:false) wins
    expect(out.find((e) => e.id === "estate")!.visible).toBe(false);
  });

  it("forces at least one visible when all stored are hidden", () => {
    const stored = REPORT_KEYS.map((id) => ({ id, visible: false }));
    const out = resolveReportLayout(stored);
    expect(out.some((e) => e.visible)).toBe(true);
    expect(out[0].visible).toBe(true);
  });

  it("treats a corrupted non-array stored value as empty → canonical defaults", () => {
    // A jsonb row that somehow isn't an array must not throw the for…of.
    const out = resolveReportLayout({ nope: true } as never);
    expect(out.map((e) => e.id)).toEqual([...REPORT_KEYS]);
    expect(out.every((e) => e.visible)).toBe(true);
  });

  it("coerces a missing/non-boolean visible flag to a boolean", () => {
    const out = resolveReportLayout([{ id: "portfolio" }] as never);
    expect(out.find((e) => e.id === "portfolio")!.visible).toBe(false);
  });
});

describe("layout helpers", () => {
  const layout: ReportLayoutEntry[] = [
    { id: "portfolio", visible: false },
    { id: "monteCarlo", visible: true },
    { id: "cashflow", visible: true },
  ];

  it("visibleReportsInOrder filters + orders", () => {
    expect(visibleReportsInOrder(layout)).toEqual(["monteCarlo", "cashflow"]);
  });

  it("firstVisibleReport returns the first visible", () => {
    expect(firstVisibleReport(layout)).toBe("monteCarlo");
  });

  it("isReportVisible checks membership + visibility", () => {
    expect(isReportVisible("portfolio", layout)).toBe(false);
    expect(isReportVisible("cashflow", layout)).toBe(true);
  });

  it("resolveActiveReport keeps a visible preference", () => {
    expect(resolveActiveReport("cashflow", layout)).toBe("cashflow");
  });

  it("resolveActiveReport falls back when the preference is hidden", () => {
    expect(resolveActiveReport("portfolio", layout)).toBe("monteCarlo");
  });
});

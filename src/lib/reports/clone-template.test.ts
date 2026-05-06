import { describe, it, expect } from "vitest";

import { cloneTemplateWithFreshIds } from "./clone-template";
import { annualReviewTemplate } from "./templates/annual-review";
import { retirementRoadmapTemplate } from "./templates/retirement-roadmap";
import type { Page, Widget } from "./types";

function collectIds(pages: Page[]): {
  pageIds: string[];
  rowIds: string[];
  widgetIds: string[];
} {
  const pageIds: string[] = [];
  const rowIds: string[] = [];
  const widgetIds: string[] = [];
  for (const page of pages) {
    pageIds.push(page.id);
    for (const row of page.rows) {
      rowIds.push(row.id);
      for (const slot of row.slots) {
        if (slot) widgetIds.push(slot.id);
      }
    }
  }
  return { pageIds, rowIds, widgetIds };
}

function collectWidgets(pages: Page[]): Widget[] {
  const out: Widget[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      for (const slot of row.slots) {
        if (slot) out.push(slot);
      }
    }
  }
  return out;
}

describe("cloneTemplateWithFreshIds — annual review", () => {
  it("preserves page/row/widget counts", () => {
    const cloned = cloneTemplateWithFreshIds(annualReviewTemplate);
    expect(cloned.pages.length).toBe(4);
    expect(cloned.pages.length).toBe(annualReviewTemplate.pages.length);

    for (let i = 0; i < cloned.pages.length; i++) {
      expect(cloned.pages[i].rows.length).toBe(
        annualReviewTemplate.pages[i].rows.length,
      );
      for (let j = 0; j < cloned.pages[i].rows.length; j++) {
        expect(cloned.pages[i].rows[j].slots.length).toBe(
          annualReviewTemplate.pages[i].rows[j].slots.length,
        );
      }
    }
  });

  it("regenerates every page, row, and widget id", () => {
    const cloned = cloneTemplateWithFreshIds(annualReviewTemplate);
    const original = collectIds(annualReviewTemplate.pages);
    const next = collectIds(cloned.pages);

    // No id from the original tree should appear in the cloned tree.
    const originalSet = new Set([
      ...original.pageIds,
      ...original.rowIds,
      ...original.widgetIds,
    ]);
    for (const id of [...next.pageIds, ...next.rowIds, ...next.widgetIds]) {
      expect(originalSet.has(id)).toBe(false);
    }

    // And every cloned id should be unique within the clone itself.
    const clonedAll = [...next.pageIds, ...next.rowIds, ...next.widgetIds];
    expect(new Set(clonedAll).size).toBe(clonedAll.length);
  });

  it("preserves widget kinds and props", () => {
    const cloned = cloneTemplateWithFreshIds(annualReviewTemplate);
    const originalWidgets = collectWidgets(annualReviewTemplate.pages);
    const clonedWidgets = collectWidgets(cloned.pages);

    expect(clonedWidgets.length).toBe(originalWidgets.length);
    for (let i = 0; i < clonedWidgets.length; i++) {
      expect(clonedWidgets[i].kind).toBe(originalWidgets[i].kind);
      expect(clonedWidgets[i].props).toEqual(originalWidgets[i].props);
    }
  });

  it("does not mutate the original template", () => {
    const beforeIds = collectIds(annualReviewTemplate.pages);
    const beforeJson = JSON.stringify(annualReviewTemplate);

    cloneTemplateWithFreshIds(annualReviewTemplate);

    const afterIds = collectIds(annualReviewTemplate.pages);
    expect(afterIds).toEqual(beforeIds);
    expect(JSON.stringify(annualReviewTemplate)).toBe(beforeJson);
  });
});

describe("cloneTemplateWithFreshIds — retirement roadmap", () => {
  it("clones to 5 pages", () => {
    const cloned = cloneTemplateWithFreshIds(retirementRoadmapTemplate);
    expect(cloned.pages.length).toBe(5);
  });

  it("regenerates every id and preserves kinds/props", () => {
    const cloned = cloneTemplateWithFreshIds(retirementRoadmapTemplate);
    const original = collectIds(retirementRoadmapTemplate.pages);
    const next = collectIds(cloned.pages);

    const originalSet = new Set([
      ...original.pageIds,
      ...original.rowIds,
      ...original.widgetIds,
    ]);
    for (const id of [...next.pageIds, ...next.rowIds, ...next.widgetIds]) {
      expect(originalSet.has(id)).toBe(false);
    }

    const originalWidgets = collectWidgets(retirementRoadmapTemplate.pages);
    const clonedWidgets = collectWidgets(cloned.pages);
    expect(clonedWidgets.length).toBe(originalWidgets.length);
    for (let i = 0; i < clonedWidgets.length; i++) {
      expect(clonedWidgets[i].kind).toBe(originalWidgets[i].kind);
      expect(clonedWidgets[i].props).toEqual(originalWidgets[i].props);
    }
  });
});

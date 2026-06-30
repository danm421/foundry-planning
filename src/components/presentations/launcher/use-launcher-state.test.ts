import { describe, it, expect } from "vitest";
import { launcherReducer, initialLauncherState } from "./use-launcher-state";
import type { LauncherState } from "./use-launcher-state";

describe("launcherReducer", () => {
  const base: LauncherState = initialLauncherState();

  it("addPage appends to pages", () => {
    const next = launcherReducer(base, {
      type: "addPage",
      pageId: "cashFlow",
      options: { range: "full", showCallout: true },
    });
    expect(next.pages).toHaveLength(1);
    expect(next.pages[0].pageId).toBe("cashFlow");
  });

  it("removePage removes by index", () => {
    const s1 = launcherReducer(base, {
      type: "addPage",
      pageId: "cashFlow",
      options: { range: "full", showCallout: true },
    });
    const s2 = launcherReducer(s1, { type: "removePage", index: 0 });
    expect(s2.pages).toHaveLength(0);
  });

  it("reorder moves a page", () => {
    const customRange = { startYear: 2031, endYear: 2036 };
    let s: LauncherState = base;
    s = launcherReducer(s, {
      type: "addPage",
      pageId: "cashFlow",
      options: { range: "full", showCallout: true },
    });
    s = launcherReducer(s, {
      type: "addPage",
      pageId: "cashFlow",
      options: { range: customRange, showCallout: true },
    });
    const moved = launcherReducer(s, { type: "reorder", from: 0, to: 1 });
    expect((moved.pages[0].options as { range: unknown }).range).toEqual(customRange);
    expect((moved.pages[1].options as { range: string }).range).toBe("full");
  });

  it("updatePageOptions changes one page's options", () => {
    const customRange = { startYear: 2031, endYear: 2036 };
    const s1 = launcherReducer(base, {
      type: "addPage",
      pageId: "cashFlow",
      options: { range: "full", showCallout: true },
    });
    const s2 = launcherReducer(s1, {
      type: "updatePageOptions",
      index: 0,
      options: { range: customRange, showCallout: true },
    });
    expect((s2.pages[0].options as { range: unknown }).range).toEqual(customRange);
  });

  it("setScenarioOverride sets a per-page override and supports reset to undefined", () => {
    const s1 = launcherReducer(base, {
      type: "addPage",
      pageId: "cashFlow",
      options: { range: "full", showCallout: true },
    });
    const s2 = launcherReducer(s1, {
      type: "setScenarioOverride",
      index: 0,
      value: "scenario-A",
    });
    expect(s2.pages[0].scenarioOverride).toBe("scenario-A");
    const s3 = launcherReducer(s2, {
      type: "setScenarioOverride",
      index: 0,
      value: undefined,
    });
    expect(s3.pages[0].scenarioOverride).toBe(undefined);
  });

  it("loadTemplate replaces pages and records loadedTemplate", () => {
    const tpl = {
      id: "tpl1",
      name: "T",
      visibility: "shared" as const,
      createdByUserId: "u",
      pages: [
        {
          pageId: "cashFlow" as const,
          options: { range: "full", showCallout: false },
        },
      ],
    };
    const next = launcherReducer(base, { type: "loadTemplate", template: tpl });
    expect(next.loadedTemplate?.id).toBe("tpl1");
    expect(next.pages).toHaveLength(1);
  });

  it("hydrate replaces the whole state with the restored draft", () => {
    const draft: LauncherState = {
      topScenarioPickerValue: "snap:abc",
      filename: "Draft_Deck.pdf",
      pages: [
        {
          pageId: "cashFlow",
          options: { range: "full", showCallout: true },
          scenarioOverride: "scenario-X",
        },
      ],
      loadedTemplate: null,
      isModified: true,
    };
    const next = launcherReducer(base, { type: "hydrate", state: draft });
    expect(next).toEqual(draft);
    expect(next.pages[0].scenarioOverride).toBe("scenario-X");
    expect(next.isModified).toBe(true);
  });

  it("isModified is false right after loadTemplate and true after editing", () => {
    const customRange = { startYear: 2031, endYear: 2036 };
    const tpl = {
      id: "t",
      name: "T",
      visibility: "shared" as const,
      createdByUserId: "u",
      pages: [
        {
          pageId: "cashFlow" as const,
          options: { range: "full", showCallout: true },
        },
      ],
    };
    const s1 = launcherReducer(base, { type: "loadTemplate", template: tpl });
    expect(s1.isModified).toBe(false);
    const s2 = launcherReducer(s1, {
      type: "updatePageOptions",
      index: 0,
      options: { range: customRange, showCallout: true },
    });
    expect(s2.isModified).toBe(true);
  });
});

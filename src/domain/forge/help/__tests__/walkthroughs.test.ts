import { describe, it, expect } from "vitest";
import {
  WALKTHROUGHS,
  getWalkthrough,
  walkthroughIndex,
  getHelpTopic,
  HELP_HREF_ALLOWLIST_PREFIXES,
} from "../catalog";

describe("walkthrough catalog", () => {
  it("has the add-household flagship walkthrough with 5 steps", () => {
    const w = getWalkthrough("add-household");
    expect(w).toBeDefined();
    expect(w!.steps).toHaveLength(5);
    expect(w!.steps[0].anchorId).toBe("crm-new-household-button");
    expect(w!.steps[4].anchorId).toBe("crm-household-save-button");
  });

  it("has no duplicate walkthrough ids", () => {
    const ids = WALKTHROUGHS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every step page starts with an allowlisted prefix", () => {
    for (const w of WALKTHROUGHS) {
      for (const s of w.steps) {
        const ok = HELP_HREF_ALLOWLIST_PREFIXES.some((p) => s.page.startsWith(p));
        expect(ok, `${w.id}/${s.anchorId} page ${s.page}`).toBe(true);
      }
    }
  });

  it("every navigate step declares a nextPage; every anchorId is non-empty", () => {
    for (const w of WALKTHROUGHS) {
      for (const s of w.steps) {
        expect(s.anchorId.length).toBeGreaterThan(0);
        if (s.advanceOn === "navigate") expect(s.nextPage && s.nextPage.length > 0).toBe(true);
      }
    }
  });

  it("every topic.walkthroughId resolves to a real walkthrough", () => {
    // A HelpTopic that advertises a tour must point at one that exists.
    const t = getHelpTopic("add-household");
    expect(t?.walkthroughId).toBe("add-household");
    expect(getWalkthrough(t!.walkthroughId!)).toBeDefined();
  });

  it("walkthroughIndex lists id — title for each walkthrough", () => {
    expect(walkthroughIndex()).toContain("add-household — Add a new household");
  });
});

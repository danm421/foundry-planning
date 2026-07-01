import { describe, it, expect } from "vitest";
import {
  HELP_TOPICS,
  findHelpTopics,
  getHelpTopic,
  helpTopicIndex,
  HELP_HREF_ALLOWLIST_PREFIXES,
} from "../catalog";

describe("help catalog integrity", () => {
  it("has unique topic ids", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every href starts with an allowlisted prefix", () => {
    for (const t of HELP_TOPICS) {
      const ok = HELP_HREF_ALLOWLIST_PREFIXES.some((p) => t.href.startsWith(p));
      expect(ok, `${t.id} href ${t.href} not allowlisted`).toBe(true);
    }
  });

  it("every topic has at least one step and one keyword", () => {
    for (const t of HELP_TOPICS) {
      expect(t.steps.length, t.id).toBeGreaterThan(0);
      expect(t.keywords.length, t.id).toBeGreaterThan(0);
    }
  });

  it("includes an add-household topic", () => {
    const t = getHelpTopic("add-household");
    expect(t?.href).toBe("/crm/new");
  });
});

describe("findHelpTopics", () => {
  it("matches on keyword", () => {
    const hits = findHelpTopics("new household");
    expect(hits.map((t) => t.id)).toContain("add-household");
  });
  it("returns [] for nonsense", () => {
    expect(findHelpTopics("zzzqqq")).toEqual([]);
  });
  it("caps at 5 results", () => {
    expect(findHelpTopics("a").length).toBeLessThanOrEqual(5);
  });
});

describe("helpTopicIndex", () => {
  it("lists id — title pairs", () => {
    expect(helpTopicIndex()).toContain("add-household — Add a new client or household");
  });
});

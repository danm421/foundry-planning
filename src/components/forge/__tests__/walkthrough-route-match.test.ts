import { describe, it, expect } from "vitest";
import { matchesWalkthroughRoute } from "../walkthrough-route-match";

describe("matchesWalkthroughRoute", () => {
  it("matches a concrete route exactly", () => {
    expect(matchesWalkthroughRoute("/crm/new", "/crm/new")).toBe(true);
    expect(matchesWalkthroughRoute("/crm/new", "/crm/households/x")).toBe(false);
  });
  it("treats :id as a single-segment wildcard", () => {
    expect(matchesWalkthroughRoute("/crm/households/:id", "/crm/households/abc123")).toBe(true);
    expect(matchesWalkthroughRoute("/crm/households/:id", "/crm/households")).toBe(false);
    expect(matchesWalkthroughRoute("/crm/households/:id", "/crm/households/a/b")).toBe(false);
  });
});

// src/domain/forge/__tests__/load-prompt-context.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock the client lookup: a named household so the title is deterministic ---
vi.mock("@/lib/clients/get-client-with-contacts", () => ({
  getClientWithContacts: vi.fn(async () => ({
    firstName: "Maria",
    lastName: "Reyes",
    spouseFirstName: "Tom",
  })),
}));

// --- mock the scenario lookup: db.select().from().where().limit() resolves to a row ---
const scenarioRow = { name: "Base Case", isBaseCase: true };
vi.mock("@/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [scenarioRow],
  };
  return { db: chain };
});

// --- mock the long-term store; each test sets getStore's behaviour ---
const search = vi.fn();
const getStore = vi.fn(() => ({ search }));
vi.mock("../store", () => ({ getStore: () => getStore() }));

import { loadPromptContext } from "../load-prompt-context";

const baseArgs = {
  clientId: "c1",
  firmId: "org_A",
  scenarioId: "base",
  firmName: "Northstar",
};

describe("loadPromptContext memory loading", () => {
  beforeEach(() => {
    search.mockReset();
    getStore.mockClear();
  });

  it("assembles knownPreferences from both client and advisor namespaces, scope-prefixed", async () => {
    // First call → client namespace, second call → advisor namespace.
    search
      .mockResolvedValueOnce([{ key: "risk", value: { value: "very conservative" } }])
      .mockResolvedValueOnce([{ key: "style", value: { value: "brief, numbers-first" } }]);

    const ctx = await loadPromptContext({ ...baseArgs, userId: "u1" });

    expect(ctx.knownPreferences).toContain("Client — risk: very conservative");
    expect(ctx.knownPreferences).toContain("You — style: brief, numbers-first");
    // base context still flows through
    expect(ctx.firmName).toBe("Northstar");
    expect(ctx.client.householdTitle).toBe("Maria Reyes & Tom");
  });

  it("passes advisorName and todayISO through to the returned context", async () => {
    search.mockResolvedValue([]);
    const ctx = await loadPromptContext({
      ...baseArgs,
      userId: "u1",
      advisorName: "Dana",
      todayISO: "2026-06-22",
    });
    expect(ctx.advisorName).toBe("Dana");
    expect(ctx.todayISO).toBe("2026-06-22");
  });

  it("skips the advisor namespace search when userId is absent (loads client prefs only)", async () => {
    search.mockResolvedValue([{ key: "risk", value: { value: "very conservative" } }]);

    const ctx = await loadPromptContext({ ...baseArgs });

    // Only the client namespace was searched — advisor namespace skipped.
    expect(search).toHaveBeenCalledTimes(1);
    expect(ctx.knownPreferences).toContain("Client — risk: very conservative");
    expect(ctx.knownPreferences).not.toContain("You — risk: very conservative");
  });

  it("fails open to [] when the store throws — never dead-ends a turn", async () => {
    search.mockRejectedValue(new Error("store down"));

    const ctx = await loadPromptContext({ ...baseArgs, userId: "u1" });

    expect(ctx.knownPreferences).toEqual([]);
    // the rest of the context still returns
    expect(ctx.firmName).toBe("Northstar");
    expect(ctx.scenario).toEqual({ name: "Base Case", isBaseCase: true });
  });
});

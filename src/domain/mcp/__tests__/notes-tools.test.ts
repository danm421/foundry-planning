import { describe, it, expect, vi, beforeEach } from "vitest";

const { listHouseholdNotesPage, getHouseholdNotesField, resolveActors, assertHouseholdReadable } =
  vi.hoisted(() => ({
    listHouseholdNotesPage: vi.fn(),
    getHouseholdNotesField: vi.fn(),
    resolveActors: vi.fn(),
    assertHouseholdReadable: vi.fn(),
  }));

vi.mock("@/lib/crm/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm/notes")>()),
  listHouseholdNotesPage,
  getHouseholdNotesField,
}));
vi.mock("@/lib/activity/resolve-actors", () => ({ resolveActors }));
vi.mock("../guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guards")>()),
  assertHouseholdReadableForPrincipal: assertHouseholdReadable,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { notesTools } from "../tools/notes";
import { NOTE_BODY_MAX } from "@/lib/crm/notes-window";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "user_1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "sub_1",
};
const byName = (n: string) => notesTools.find((t) => t.name === n)!;

const note = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  kind: "meeting",
  title: "Annual review",
  body: "Discussed the Roth conversion.",
  occurredAt: "2026-06-01T12:00:00.000Z",
  actorUserId: "user_1",
  updatedAt: "2026-06-01T12:00:00.000Z",
  ...over,
});

beforeEach(() => {
  listHouseholdNotesPage.mockReset();
  getHouseholdNotesField.mockReset().mockResolvedValue(null);
  resolveActors.mockReset();
  assertHouseholdReadable.mockReset().mockResolvedValue(undefined);
  resolveActors.mockResolvedValue(new Map([["user_1", { name: "Dan Mueller" }]]));
});

describe("list_client_notes", () => {
  it("returns the window with author names, the standing field, and a CRM deep link", async () => {
    listHouseholdNotesPage.mockResolvedValue({ notes: [note()], totalCount: 1 });
    getHouseholdNotesField.mockResolvedValue("Golfs with the CFO.");
    const out = await byName("list_client_notes").run({ householdId: "hh1" }, principal) as Record<string, unknown>;
    expect(out.notes).toEqual([{
      id: "n1",
      kind: "meeting",
      subject: "Annual review",
      occurredAt: "2026-06-01T12:00:00.000Z",
      author: "Dan Mueller",
      body: "Discussed the Roth conversion.",
      truncated: false,
    }]);
    expect(out.householdNotes).toBe("Golfs with the CFO.");
    expect(out.totalCount).toBe(1);
    expect(out.hasMore).toBe(false);
    expect(out.foundryUrl).toContain("/crm/households/hh1?tab=notes");
  });

  it("flags a long body as truncated", async () => {
    listHouseholdNotesPage.mockResolvedValue({
      notes: [note({ body: "word ".repeat(400).trim() })],
      totalCount: 1,
    });
    const out = await byName("list_client_notes").run({ householdId: "hh1" }, principal) as Record<string, unknown>;
    const first = (out.notes as Array<Record<string, unknown>>)[0];
    expect(first.truncated).toBe(true);
    expect((first.body as string).length).toBeLessThanOrEqual(NOTE_BODY_MAX);
  });

  it("reports hasMore when the window is narrower than the match count", async () => {
    listHouseholdNotesPage.mockResolvedValue({ notes: [note()], totalCount: 9 });
    const out = await byName("list_client_notes").run({ householdId: "hh1", limit: 1 }, principal) as Record<string, unknown>;
    expect(out.hasMore).toBe(true);
  });

  it("falls back to 'Former member' for an unresolvable author", async () => {
    resolveActors.mockResolvedValue(new Map());
    listHouseholdNotesPage.mockResolvedValue({ notes: [note({ actorUserId: "user_gone" })], totalCount: 1 });
    const out = await byName("list_client_notes").run({ householdId: "hh1" }, principal) as Record<string, unknown>;
    expect((out.notes as Array<Record<string, unknown>>)[0].author).toBe("Former member");
  });

  it("passes the filter straight through to the loader", async () => {
    listHouseholdNotesPage.mockResolvedValue({ notes: [], totalCount: 0 });
    await byName("list_client_notes").run(
      { householdId: "hh1", limit: 5, since: "2026-01-01", until: "2026-06-30", kinds: ["call"] },
      principal,
    );
    expect(listHouseholdNotesPage).toHaveBeenCalledWith("hh1", "org_1", {
      limit: 5, since: "2026-01-01", until: "2026-06-30", kinds: ["call"],
    });
  });

  it("rejects a kind the enum does not know", async () => {
    await expect(
      byName("list_client_notes").run({ householdId: "hh1", kinds: ["gossip"] }, principal),
    ).rejects.toThrow();
  });
});

describe("get_client_note", () => {
  it("returns one note with its body in full", async () => {
    const long = "word ".repeat(400).trim();
    listHouseholdNotesPage.mockResolvedValue({ notes: [note({ body: long })], totalCount: 1 });
    const out = await byName("get_client_note").run(
      { householdId: "hh1", noteId: "n1" }, principal,
    ) as Record<string, unknown>;
    expect(out.body).toBe(long);
    expect(out.truncated).toBeUndefined();
  });

  it("raises the shared not-found message for an unknown note", async () => {
    listHouseholdNotesPage.mockResolvedValue({ notes: [note({ id: "other" })], totalCount: 1 });
    await expect(
      byName("get_client_note").run({ householdId: "hh1", noteId: "n1" }, principal),
    ).rejects.toThrow("Household not found or access denied");
  });
});

describe("both tools are household-guarded", () => {
  it.each(["list_client_notes", "get_client_note"])("%s declares householdId", (name) => {
    expect("householdId" in byName(name).inputSchema.shape).toBe(true);
  });
});

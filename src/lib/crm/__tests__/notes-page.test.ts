import { describe, it, expect, vi, beforeEach } from "vitest";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select } }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { listHouseholdNotesPage } from "../notes";

// The drizzle chain listHouseholdNotes uses: select().from().where().orderBy()
// resolves to the rows. Each link returns `this` until orderBy resolves.
function mockRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => Promise.resolve(rows);
  select.mockReturnValue(chain);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  kind: "note",
  title: "Subject",
  body: "Body",
  occurredAt: new Date("2026-06-01T12:00:00.000Z"),
  actorUserId: "user_1",
  updatedAt: new Date("2026-06-01T12:00:00.000Z"),
  ...over,
});

beforeEach(() => select.mockReset());

describe("listHouseholdNotesPage", () => {
  it("reports totalCount before the limit and returns only the window", async () => {
    mockRows([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
    const out = await listHouseholdNotesPage("hh1", "org_1", { limit: 2 });
    expect(out.totalCount).toBe(3);
    expect(out.notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("counts only rows that survive the filter", async () => {
    mockRows([
      row({ id: "a", kind: "call" }),
      row({ id: "b", kind: "meeting" }),
      row({ id: "c", kind: "call" }),
    ]);
    const out = await listHouseholdNotesPage("hh1", "org_1", { kinds: ["call"] });
    expect(out.totalCount).toBe(2);
    expect(out.notes.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("clamps an absurd limit rather than honouring it", async () => {
    mockRows(Array.from({ length: 150 }, (_, i) => row({ id: `n${i}` })));
    const out = await listHouseholdNotesPage("hh1", "org_1", { limit: 10_000 });
    expect(out.notes).toHaveLength(100);
    expect(out.totalCount).toBe(150);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const orderByMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    selectDistinctOn: (_on: unknown, _cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: (..._o: unknown[]) => orderByMock(),
        }),
      }),
    }),
  },
}));

import { loadLastRemindedAt } from "../reminders";

beforeEach(() => {
  orderByMock.mockReset();
});

describe("loadLastRemindedAt", () => {
  it("keys each form's reminder by its form id", async () => {
    // DISTINCT ON has already collapsed each form to its newest row.
    orderByMock.mockResolvedValue([
      { resourceId: "form-a", createdAt: new Date("2026-09-10T12:00:00Z") },
      { resourceId: "form-b", createdAt: new Date("2026-09-08T12:00:00Z") },
    ]);

    const out = await loadLastRemindedAt("firm-1", ["form-a", "form-b"]);

    expect(out["form-a"]).toEqual(new Date("2026-09-10T12:00:00Z"));
    expect(out["form-b"]).toEqual(new Date("2026-09-08T12:00:00Z"));
  });

  it("omits a form that has never been reminded", async () => {
    orderByMock.mockResolvedValue([
      { resourceId: "form-a", createdAt: new Date("2026-09-10T12:00:00Z") },
    ]);

    const out = await loadLastRemindedAt("firm-1", ["form-a", "form-never"]);

    // Absent, not null: "never chased" must not render as a date.
    expect(out).not.toHaveProperty("form-never");
  });

  it("asks the DB nothing when there are no forms in flight", async () => {
    expect(await loadLastRemindedAt("firm-1", [])).toEqual({});
    expect(orderByMock).not.toHaveBeenCalled();
  });
});

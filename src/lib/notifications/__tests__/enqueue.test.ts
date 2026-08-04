import { describe, it, expect, vi, beforeEach } from "vitest";

const selectRows = vi.fn();
const insertValues = vi.fn();
const onConflictDoNothing = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(selectRows()) }),
    }),
    insert: () => ({
      values: (rows: unknown) => {
        insertValues(rows);
        return { onConflictDoNothing: () => Promise.resolve(onConflictDoNothing()) };
      },
    }),
  },
}));

import { enqueueNotifications } from "../enqueue";

const base = {
  firmId: "org_1",
  category: "intake_submitted" as const,
  actorUserId: null,
  clientId: "client-1",
  title: "The Johnsons submitted their intake form",
  url: "/data-collection/form-1",
};

beforeEach(() => {
  selectRows.mockReset().mockReturnValue([]);
  insertValues.mockReset();
  onConflictDoNothing.mockReset();
});

describe("enqueueNotifications", () => {
  it("inserts one row per recipient using shipped defaults when no prefs row exists", async () => {
    await enqueueNotifications({ ...base, recipients: ["u1", "u2"] });
    expect(insertValues).toHaveBeenCalledTimes(1);
    const rows = insertValues.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // shipped default: in-app on, email off
    expect(rows[0]).toMatchObject({ userId: "u1", inApp: true, emailPending: false });
  });

  it("honours a stored preference row", async () => {
    selectRows.mockReturnValue([
      { userId: "u1", channels: { intake_submitted: { inApp: false, email: true } } },
    ]);
    await enqueueNotifications({ ...base, recipients: ["u1"] });
    const rows = insertValues.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ inApp: false, emailPending: true });
  });

  it("skips the insert entirely when no rows survive planning", async () => {
    selectRows.mockReturnValue([
      { userId: "u1", channels: { intake_submitted: { inApp: false, email: false } } },
    ]);
    await enqueueNotifications({ ...base, recipients: ["u1"] });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("no-ops on an empty recipient list without touching the database", async () => {
    await enqueueNotifications({ ...base, recipients: [] });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("uses onConflictDoNothing so a repeated dedupKey cannot raise", async () => {
    await enqueueNotifications({ ...base, recipients: ["u1"], dedupKey: "k1" });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  // The contract that matters most: a notification failure must never roll back
  // or surface into the business write that triggered it.
  it("swallows a database error instead of throwing to its caller", async () => {
    selectRows.mockImplementation(() => {
      throw new Error("connection reset");
    });
    await expect(
      enqueueNotifications({ ...base, recipients: ["u1"] }),
    ).resolves.toBeUndefined();
  });

  it("refuses an unknown category rather than writing an unrenderable row", async () => {
    await enqueueNotifications({
      ...base,
      category: "not_a_real_category" as never,
      recipients: ["u1"],
    });
    expect(insertValues).not.toHaveBeenCalled();
  });
});

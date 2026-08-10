import { describe, it, expect, vi, beforeEach } from "vitest";

const { update, select } = vi.hoisted(() => ({ update: vi.fn(), select: vi.fn() }));
vi.mock("@/db", () => ({ db: { update, select } }));

import { MissingTaxReturnStateError } from "../../errors";
import { putSecondRead, dismissSecondReadItem, parseStoredSecondRead } from "../store";
import { SECOND_READ_VERSION, type SecondRead } from "../types";

function read(over: Partial<SecondRead> = {}): SecondRead {
  return {
    generatedAt: "2026-08-10T12:00:00.000Z",
    warnings: [],
    items: [
      { id: "sr-1", headline: "h1", detail: "d1", form: null, line: null, quotedValue: null, dismissed: false },
      { id: "sr-2", headline: "h2", detail: "d2", form: null, line: null, quotedValue: null, dismissed: false },
    ],
    ...over,
  };
}

/** `db.update(...).set(...).where(...).returning()` resolving to `rows`. */
function mockUpdate(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  update.mockReturnValue({ set });
  return { set, returning };
}

/** `db.select().from(...).where(...).limit(1)` resolving to `rows`. */
function mockSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  select.mockReturnValue({ from });
  return { from };
}

beforeEach(() => vi.clearAllMocks());

describe("putSecondRead", () => {
  it("writes the blob, the document hash, and the prompt version together", async () => {
    const { set } = mockUpdate([{ taxReturnId: "r1" }]);
    await putSecondRead("r1", read(), "hash-abc");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        aiSecondRead: read(),
        aiSecondReadDocHash: "hash-abc",
        aiSecondReadVersion: SECOND_READ_VERSION,
      }),
    );
  });

  it("advances updatedAt explicitly — the column has no $onUpdate", async () => {
    const { set } = mockUpdate([{ taxReturnId: "r1" }]);
    await putSecondRead("r1", read(), "hash-abc");
    expect(set.mock.calls[0][0].updatedAt).toBeInstanceOf(Date);
  });

  it("REFUSES to create a state row that does not exist", async () => {
    mockUpdate([]);
    await expect(putSecondRead("r1", read(), "hash-abc")).rejects.toBeInstanceOf(
      MissingTaxReturnStateError,
    );
  });
});

describe("dismissSecondReadItem", () => {
  it("marks only the named item and leaves the rest alone", async () => {
    mockSelect([{ aiSecondRead: read() }]);
    const { set } = mockUpdate([{ taxReturnId: "r1" }]);

    const next = await dismissSecondReadItem("r1", "sr-2");

    expect(next!.items.map((i) => i.dismissed)).toEqual([false, true]);
    expect(set.mock.calls[0][0].aiSecondRead.items[1].dismissed).toBe(true);
  });

  it("does NOT touch the hash or the version — dismissing is not regenerating", async () => {
    mockSelect([{ aiSecondRead: read() }]);
    const { set } = mockUpdate([{ taxReturnId: "r1" }]);
    await dismissSecondReadItem("r1", "sr-1");
    expect(set.mock.calls[0][0]).not.toHaveProperty("aiSecondReadDocHash");
    expect(set.mock.calls[0][0]).not.toHaveProperty("aiSecondReadVersion");
  });

  it("returns null when there is no stored read at all", async () => {
    mockSelect([{ aiSecondRead: null }]);
    expect(await dismissSecondReadItem("r1", "sr-1")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("returns null when the item id is not in the stored read", async () => {
    mockSelect([{ aiSecondRead: read() }]);
    expect(await dismissSecondReadItem("r1", "sr-99")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("returns null when there is no state row", async () => {
    mockSelect([]);
    expect(await dismissSecondReadItem("r1", "sr-1")).toBeNull();
  });
});

describe("parseStoredSecondRead", () => {
  it("returns null for null rather than a hollow object", () => {
    expect(parseStoredSecondRead(null)).toBeNull();
  });

  it("returns null for a blob that cannot be parsed — a bad blob hides the panel, never the tab", () => {
    expect(parseStoredSecondRead({ nope: true })).toBeNull();
  });

  it("parses a stored blob", () => {
    expect(parseStoredSecondRead(read())?.items).toHaveLength(2);
  });
});

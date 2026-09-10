import { describe, it, expect } from "vitest";
import { readChatState, writeChatState } from "@/lib/statement-chat/state";

describe("chat state", () => {
  it("returns an empty state for a payload that has never seen the chat surface", () => {
    expect(readChatState({})).toEqual({
      surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [],
    });
  });

  it("round-trips a partial write without disturbing sibling keys", () => {
    const before = { payload: { accounts: [] }, fileResults: { a: {} } };
    const after = writeChatState(before, { committedRowIds: ["r1"] });
    expect(after.payload).toEqual({ accounts: [] });
    expect(after.fileResults).toEqual({ a: {} });
    expect(readChatState(after).committedRowIds).toEqual(["r1"]);
  });

  it("never loses an existing transcript on a partial write", () => {
    const seeded = writeChatState({}, { transcript: [{ role: "user", text: "hi", at: "2026-09-09T00:00:00Z" }] });
    const after = writeChatState(seeded, { committedRowIds: ["r1"] });
    expect(readChatState(after).transcript).toHaveLength(1);
  });

  // C8: `Partial<ChatState>` lets a caller pass a key explicitly set to
  // `undefined` (as opposed to simply omitting it). The brief's "nothing is
  // deleted" promise only holds for omitted keys unless writeChatState
  // strips explicit `undefined`s too — pinning the choice made here (strip).
  it("treats an explicit `undefined` field the same as an omitted one (C8)", () => {
    const seeded = writeChatState({}, { transcript: [{ role: "user", text: "hi", at: "2026-09-09T00:00:00Z" }] });
    const after = writeChatState(seeded, { transcript: undefined, committedRowIds: ["r1"] });
    expect(readChatState(after).transcript).toHaveLength(1);
    expect(readChatState(after).committedRowIds).toEqual(["r1"]);
  });
});

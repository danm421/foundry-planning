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

  // Round 1 review, Important 2: a `chat` slice written by an earlier
  // `ChatState` shape (Phase 2 is specced to extend it) or hand-edited data
  // can carry only SOME of the fields. Without normalizing against
  // `emptyChatState()`, a caller doing `readChatState(x).decisions.map(...)`
  // on a payload like this would throw on `undefined`.
  it("fills in missing arrays on a chat slice that predates a field (Important 2)", () => {
    const legacy = { chat: { surface: "chat" as const, transcript: [{ role: "user" as const, text: "hi", at: "2026-09-09T00:00:00Z" }] } };
    const state = readChatState(legacy);
    expect(state.transcript).toHaveLength(1);
    expect(state.decisions).toEqual([]);
    expect(state.excludedRows).toEqual([]);
    expect(state.committedRowIds).toEqual([]);
  });

  // A non-object `chat` (hand-edited or corrupted data) must degrade to the
  // empty shape rather than crash or spread garbage keys into the result.
  it("degrades a non-object chat slice to the empty shape", () => {
    const corrupted = { chat: "not an object" };
    expect(readChatState(corrupted)).toEqual({
      surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [],
    });
  });
});

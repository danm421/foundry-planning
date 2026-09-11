import { describe, it, expect } from "vitest";
import { advisorRetiredRows, readChatState, writeChatState } from "@/lib/statement-chat/state";
import type { ChatState } from "@/lib/imports/types";

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

/**
 * Fix wave 3. `excludedRows` mixes two kinds of exclusion with OPPOSITE
 * identity properties, and only one of them may be handed to the rebase:
 *
 *  - a ROLLUP exclusion is re-derived by `detectRollups` on every read and is
 *    never in `kept`, so reconciling its stale id could only let a printed
 *    total contest a real account's re-attachment and strand it;
 *  - an ADVISOR exclusion cannot be re-derived by anything, so its id must be
 *    carried forward or the row it names comes back on the next upload (I-A).
 *
 * Mutation this catches: dropping the `decision` filter, so every excluded
 * row — rollups included — is fed into the reconciliation.
 */
describe("advisorRetiredRows", () => {
  const row = (rowId: string, name: string) => ({ __rowId: rowId, name }) as never;

  it("keeps the advisor's own exclusions and drops re-derived rollups", () => {
    const chat = {
      surface: "chat",
      transcript: [],
      decisions: [],
      committedRowIds: [],
      excludedRows: [
        { row: row("account:7734#f1:0", "Dad's IRA"), reason: "not the client's" },
        {
          row: row("account:7735#f1:1", "Roth IRA (continued)"),
          reason: 'merged into "Roth IRA"',
          irreversible: true as const,
        },
        {
          row: row("account:9999#f1:2", "Total Accounts"),
          reason: "a total covering 2 accounts already listed",
          decision: { kind: "rollup-excluded" } as never,
        },
      ],
    } as ChatState;

    expect(advisorRetiredRows(chat).map((r) => r.name)).toEqual([
      "Dad's IRA",
      "Roth IRA (continued)",
    ]);
  });

  it("returns an empty list for a chat state with no exclusions", () => {
    expect(advisorRetiredRows(readChatState({}))).toEqual([]);
  });
});

import type { ChatState, ChatTurn, ImportPayloadJson } from "@/lib/imports/types";

/**
 * `ChatTurn` and `ChatState` are declared in `@/lib/imports/types` (R55),
 * not here — `ImportPayloadJson.chat` needs the type, and this module must
 * only ever import FROM `lib/imports`, never the reverse. Re-exported so
 * every statement-chat consumer can still import both from this module, per
 * the task brief.
 */
export type { ChatState, ChatTurn };

function emptyChatState(): ChatState {
  return { surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [] };
}

/**
 * Read the `chat` slice off a persisted `client_imports.payloadJson`. Returns
 * the empty shape for a payload that has never seen the chat surface, and
 * NORMALIZES whatever it finds against that empty shape rather than
 * returning it as-is (round 1 review — Important 2): a slice written by an
 * earlier `ChatState` (Phase 2 is specced to extend it), a bare `{}`, or any
 * other non-object garbage would otherwise reach a caller missing arrays it
 * assumes exist — `readChatState(x).transcript.map(...)` would throw. Every
 * field `chat` doesn't itself supply falls back to `emptyChatState()`'s, and
 * the object returned is always a fresh one, never the caller's.
 *
 * `payloadJson` is `unknown`, not `ImportPayloadJson`, because the column is
 * declared `jsonb(...)` with no `.$type<>()` (see C4) — every reader across
 * `src/lib/imports` casts at the read site the same way this does.
 */
export function readChatState(payloadJson: unknown): ChatState {
  const chat = (payloadJson as ImportPayloadJson | null | undefined)?.chat;
  const partial = chat !== null && typeof chat === "object" ? (chat as Partial<ChatState>) : {};
  return { ...emptyChatState(), ...partial };
}

/**
 * Strip keys explicitly set to `undefined` before merging `next` onto the
 * prior slice (C8). `Partial<ChatState>` lets a caller pass
 * `{ transcript: undefined }`, and a bare object spread would blank that key
 * even though every other omitted key preserves its prior value — stripping
 * makes "explicitly undefined" and "omitted" behave identically, so
 * `writeChatState`'s "nothing is deleted on a partial write" promise holds
 * without a caller having to know the difference.
 */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

/**
 * Merge `next` onto the payload's `chat` slice. Spreads the prior payload
 * first (so sibling keys — `payload`, `fileResults`, `assemble` — are
 * untouched), then the prior `chat` slice, then `next` (with any explicit
 * `undefined` stripped) — so a partial write only ever touches the fields it
 * names.
 */
export function writeChatState(payloadJson: unknown, next: Partial<ChatState>): ImportPayloadJson {
  const before = (payloadJson ?? {}) as ImportPayloadJson;
  const prior = readChatState(before);
  return {
    ...before,
    chat: { ...prior, ...stripUndefined(next) },
  };
}

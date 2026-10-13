// src/lib/fact-finder/chat/fence.ts
// Moved here from src/lib/statement-chat/turn.ts, which now imports it: one
// fence for both chats.

/** The fence around document-derived text — the ONE pair of markers every
 *  fenced block uses, and the pair a chat's system prompt names. */
export const FENCE_OPEN = "<<<UNTRUSTED DATA — extracted from client documents>>>";
export const FENCE_CLOSE = "<<<END UNTRUSTED DATA>>>";

/** Text a reader could take for either marker, in any case or spacing, with
 *  or without its angle brackets. */
const FENCE_MARKER_TEXT = /(?:<+\s*)?(?:END[\s_-]*)?UNTRUSTED[\s_-]*DATA(?:\s*>+)?/gi;

/** Replace marker-like text, so a quoted value can't end a fence or open a fake one. */
export function scrubFenceMarkers(text: string): string {
  return text.replace(FENCE_MARKER_TEXT, "[marker removed]");
}

/**
 * Wrap document-derived text in the fence. Any marker-like text INSIDE it is
 * replaced first, so a value carrying the closing marker (a custodian, an
 * account name, a re-read proposal) cannot end the fence early or open a
 * fake one — the only markers the model sees are the two this adds. The
 * text being wrapped never needs the phrase for itself: the grammar
 * around the values does not use it.
 */
export function fenceUntrusted(text: string): string {
  return `${FENCE_OPEN}\n${scrubFenceMarkers(text)}\n${FENCE_CLOSE}`;
}

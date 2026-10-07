// src/domain/forge/stream-limits.ts
//
// Size limits for the strings a Forge stream request carries
// (/api/forge/stream and /api/clients/[id]/forge/stream). Every one of them is
// kept with the conversation or the audit log and goes back to the model on
// each step of the turn, so each has a ceiling well above what the Forge panel
// ever sends. Plain constants (no zod) so the panel's composer can import them.

/** Longest message an advisor can type or paste into the Forge composer. */
export const FORGE_COMPOSER_MAX_CHARS = 100_000;

/** Longest `message` the stream routes accept: the composer's limit plus room
 *  for the "[Attached fact finder]" block and plan-update preamble the panel
 *  wraps around the advisor's words (fact-finder-turn.ts, ~2k chars at most). */
export const FORGE_MESSAGE_MAX_CHARS = FORGE_COMPOSER_MAX_CHARS + 10_000;

/** `currentPage` is sectionKeyForPath(): "client:<uuid>" or one path segment. */
export const FORGE_PAGE_MAX_CHARS = 200;

/** Conversation, scenario, import and transcript ids — uuids, or "base". */
export const FORGE_ID_MAX_CHARS = 100;

import { ProjectionInputError } from "@/lib/projection/load-client-data";

/**
 * Map a thrown error to a SAFE, user-facing message for the SSE `error` event.
 *
 * The forge stream catch must NEVER emit raw `err.message`: tool/projection
 * errors routinely embed client UUIDs, internal ids, and other machinery that
 * the advisor must not see leaked through the chat surface. This collapses every
 * error to a small set of vetted strings, defaulting to a generic fallback.
 *
 * Phase 0 has no tools so this rarely fires; the resume route (Phase 2) reuses
 * it, so it lives in its own module rather than inline in the route.
 */
const GENERIC_FALLBACK = "Something went wrong while processing your request.";
const PROJECTION_MESSAGE = "There was a problem loading this client's plan data.";

/**
 * Categorize an error into a SAFE user-facing message plus a coarse `category`
 * label (no PII — a stable tag, not the raw message). The category feeds the
 * 12-factor escalation path + observability; the message is what the SSE `error`
 * event carries. `safeForgeErrorMessage` delegates here for the message.
 */
export function categorizeForgeError(err: unknown): { safeMessage: string; category: string } {
  // Known domain error from the projection loader → safe generic, never the raw
  // message (which embeds the client id / scenario id).
  if (err instanceof ProjectionInputError) {
    return { safeMessage: PROJECTION_MESSAGE, category: "projection_input" };
  }
  // Everything else: do NOT echo arbitrary err.message — it may carry UUIDs or
  // internal detail. The safest posture is a single generic fallback.
  return { safeMessage: GENERIC_FALLBACK, category: "unknown" };
}

export function safeForgeErrorMessage(err: unknown): string {
  return categorizeForgeError(err).safeMessage;
}

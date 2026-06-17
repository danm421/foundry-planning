import { ProjectionInputError } from "@/lib/projection/load-client-data";

/**
 * Map a thrown error to a SAFE, user-facing message for the SSE `error` event.
 *
 * The copilot stream catch must NEVER emit raw `err.message`: tool/projection
 * errors routinely embed client UUIDs, internal ids, and other machinery that
 * the advisor must not see leaked through the chat surface. This collapses every
 * error to a small set of vetted strings, defaulting to a generic fallback.
 *
 * Phase 0 has no tools so this rarely fires; the resume route (Phase 2) reuses
 * it, so it lives in its own module rather than inline in the route.
 */
const GENERIC_FALLBACK = "Something went wrong while processing your request.";
const PROJECTION_MESSAGE = "There was a problem loading this client's plan data.";

export function safeForgeErrorMessage(err: unknown): string {
  // Known domain error from the projection loader → safe generic, never the raw
  // message (which embeds the client id / scenario id).
  if (err instanceof ProjectionInputError) {
    return PROJECTION_MESSAGE;
  }
  // Everything else: do NOT echo arbitrary err.message — it may carry UUIDs or
  // internal detail. The safest posture is a single generic fallback.
  return GENERIC_FALLBACK;
}

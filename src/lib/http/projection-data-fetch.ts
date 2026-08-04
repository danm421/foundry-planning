// src/lib/http/projection-data-fetch.ts
//
// The PDF export routes reuse the projection-data query by re-entering our own
// API over HTTP rather than duplicating it. That call forwards the caller's
// session cookie so it authenticates as them, which makes the origin it is
// pointed at a security decision — see internal-origin.ts.
//
// It lives here rather than inline in each route so there is ONE place the
// origin is resolved and the cookie is forwarded. Two routes had a byte-identical
// copy; a third would have been written by copying whichever one was found
// first, which is exactly how a fixed issue comes back.
import { trustedInternalOrigin } from "./internal-origin";

/** Leaves headroom for the routes' 25s render race inside the 60s maxDuration. */
const TIMEOUT_MS = 30_000;

/**
 * GETs `/api/clients/:clientId/projection-data` as the caller.
 * Returns the parsed body, or `null` if the API answered non-2xx — callers map
 * that to their own error response.
 *
 * `T` is an unchecked assertion about the body, exactly as the `await
 * res.json()` it replaced was. Callers pass `ClientData`.
 */
export async function fetchProjectionData<T = unknown>(
  request: Request,
  clientId: string,
  scenarioParam: string | null,
): Promise<T | null> {
  // Allowlisted origin, NOT `new URL(request.url).origin` — that is derived
  // from the request's own Host header, and the cookie below rides along.
  const origin = trustedInternalOrigin(request.url);
  const query = scenarioParam ? `?scenario=${encodeURIComponent(scenarioParam)}` : "";
  const res = await fetch(`${origin}/api/clients/${clientId}/projection-data${query}`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

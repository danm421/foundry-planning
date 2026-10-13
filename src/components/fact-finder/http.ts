// src/components/fact-finder/http.ts
// What the screen's requests to the fact finder routes share: the address,
// the JSON header, and the words for a request that didn't go through.

export const JSON_HEADERS = { "content-type": "application/json" };
export const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection.";

/** The import's fact finder route; its read, turn and undo routes sit under it. */
export function factFinderUrl(clientId: string, importId: string): string {
  return `/api/clients/${clientId}/imports/${importId}/fact-finder`;
}

/** A refusal in the route's own words (else `fallback` and the status), and when to retry if the route says. */
export function refusalText(res: Response, error: string | undefined, fallback: string): string {
  const retryAfter = res.headers.get("retry-after");
  return `${error ?? `${fallback} (HTTP ${res.status}).`}${retryAfter ? ` Retry in ${retryAfter}s.` : ""}`;
}

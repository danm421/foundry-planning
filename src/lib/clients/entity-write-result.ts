// Shared result type for entity write cores (expenses, incomes, liabilities,
// accounts). The cores are pure-ish functions the API routes AND the Forge
// tools both call, so they hand back a plain discriminated union instead of a
// NextResponse — the route maps {ok:false} → NextResponse.json, the tool maps it
// to a tool error. Keeping the shape uniform lets later cores be copied verbatim.
//
// `body`: a core moved out of a route whose error response isn't `{ error }`
// (`{ error, issues }`, `{ error, detail }`…) carries that response here, so
// the route answers exactly as before.

export type EntityWriteResult<T> =
  | { ok: true; data: T; resourceId: string }
  | { ok: false; status: number; error: string; body?: Record<string, unknown> };

/** Standard PII-free error-string formatter the cores hand back on {ok:false}. */
export function writeError(
  status: number,
  error: string,
  body?: Record<string, unknown>,
): { ok: false; status: number; error: string; body?: Record<string, unknown> } {
  return body ? { ok: false, status, error, body } : { ok: false, status, error };
}

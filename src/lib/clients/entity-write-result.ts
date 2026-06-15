// Shared result type for entity write cores (expenses, incomes, liabilities,
// accounts). The cores are pure-ish functions the API routes AND the Copilot
// tools both call, so they hand back a plain discriminated union instead of a
// NextResponse — the route maps {ok:false} → NextResponse.json, the tool maps it
// to a tool error. Keeping the shape uniform lets later cores be copied verbatim.

export type EntityWriteResult<T> =
  | { ok: true; data: T; resourceId: string }
  | { ok: false; status: number; error: string };

/** Standard PII-free error-string formatter the cores hand back on {ok:false}. */
export function writeError(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

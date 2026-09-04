import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/authz";

/**
 * Shared error mapper for `/api/crm/households/[id]/notes/*` route handlers.
 * - Access denials (UnauthorizedError → 401, ForbiddenError → 403, legacy
 *   `Error("Unauthorized")` → 401) are delegated to `authErrorResponse`, so the
 *   subscription gate's ForbiddenError surfaces as a 403 rather than a 500.
 * - ZodError → 400
 * - Domain not-found errors → 404. Two shapes: anything thrown by
 *   `requireCrmHouseholdAccess` (prefixed "CRM ", e.g. "CRM household not found
 *   or access denied: <id>"), and the notes module's "Note not found" /
 *   "Household not found in firm".
 * - anything else → log + 500
 */
export function mapCrmNoteError(err: unknown): NextResponse {
  const denial = authErrorResponse(err);
  if (denial) return NextResponse.json(denial.body, { status: denial.status });
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.startsWith("CRM ") || /not found( in firm)?$/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
  }
  console.error("CRM note route error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

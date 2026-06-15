import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/db-helpers";

/**
 * Shared error mapper for `/api/crm/households/[id]/notes/*` route handlers.
 * - UnauthorizedError / "Unauthorized" → 401
 * - ZodError → 400
 * - Domain not-found errors → 404. Two shapes: anything thrown by
 *   `requireCrmHouseholdAccess` (prefixed "CRM ", e.g. "CRM household not found
 *   or access denied: <id>"), and the notes module's "Note not found" /
 *   "Household not found in firm".
 * - anything else → log + 500
 */
export function mapCrmNoteError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof Error && err.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

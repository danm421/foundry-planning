import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/db-helpers";

/**
 * Shared error mapper for `/api/crm/tasks/*` route handlers. Maps domain
 * errors thrown by `src/lib/crm-tasks/*` (queries / mutations / files /
 * members) onto the appropriate HTTP status:
 *
 * - `UnauthorizedError` (or legacy `err.message === "Unauthorized"`) → 401
 * - `ZodError` (`err.name === "ZodError"`) → 400 with the validation message
 * - `err.message` starting with `"CRM "` or matching a "not found" pattern
 *   (e.g. `"Tag not found in firm"`, `"Task not found"`, `"File not found
 *   or wrong task"`) → 404
 * - anything else → log + 500
 *
 * Hoisted out of the route file so Tasks 12-18 can share a single
 * mapper without re-implementing it per route.
 */
export function mapCrmTaskError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (err instanceof Error && err.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (err instanceof Error && err.name === "ZodError") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  if (err instanceof Error) {
    const msg = err.message;
    if (msg.startsWith("CRM ") || /not found( in firm| or wrong task)?$/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
  }

  console.error("CRM task route error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

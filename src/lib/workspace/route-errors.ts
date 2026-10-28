// src/lib/workspace/route-errors.ts
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import {
  GraphRequestError,
  GraphThrottledError,
  WorkspaceNotConnectedError,
  WorkspaceReconnectRequiredError,
} from "./errors";

/**
 * Shared error mapper for `/api/workspace/*` route handlers:
 *
 * - `WorkspaceNotConnectedError` → 409 `{ error: <pane state> }`
 * - `WorkspaceReconnectRequiredError` → 409 `{ error: "needs_reconnect" }`
 *   (the pane shows "Needs to reconnect", never an empty week)
 * - `GraphThrottledError` → 503 `{ error: "throttled" }` ("Microsoft is busy",
 *   never "no meetings")
 * - `GraphRequestError` 403 / 404 → the same status, `not_allowed` / `not_found`
 * - access denials → `authErrorResponse`
 * - anything else → 500, logging only the error's name plus, for a Graph
 *   error, its status and `request-id`. Never `err.message`: a rethrown DB
 *   error's message carries query parameters (encrypted tokens, email,
 *   Microsoft user id).
 */
export function workspaceErrorResponse(err: unknown): Response {
  const denial = authErrorResponse(err);
  if (denial) return NextResponse.json(denial.body, { status: denial.status });

  if (err instanceof WorkspaceNotConnectedError) {
    return NextResponse.json({ error: err.state }, { status: 409 });
  }
  if (err instanceof WorkspaceReconnectRequiredError) {
    return NextResponse.json({ error: "needs_reconnect" }, { status: 409 });
  }
  if (err instanceof GraphThrottledError) {
    return NextResponse.json({ error: "throttled" }, { status: 503 });
  }
  if (err instanceof GraphRequestError && err.status === 403) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }
  if (err instanceof GraphRequestError && err.status === 404) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  console.error("Workspace route error:", {
    name: err instanceof Error ? err.name : typeof err,
    ...(err instanceof GraphRequestError ? { status: err.status, requestId: err.requestId } : {}),
  });
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

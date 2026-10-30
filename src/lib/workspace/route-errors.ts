// src/lib/workspace/route-errors.ts
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import {
  ProviderRequestError,
  ProviderThrottledError,
  WorkspaceNotConnectedError,
  WorkspaceReconnectRequiredError,
} from "./errors";
import { GoogleAuthError } from "./google/oauth";
import { MicrosoftAuthError } from "./microsoft/oauth";
import type { WorkspaceProvider } from "./types";

/**
 * Shared error mapper for `/api/workspace/*` route handlers:
 *
 * - `WorkspaceNotConnectedError` → 409 `{ error: <pane state> }`
 * - `WorkspaceReconnectRequiredError` → 409 `{ error: "needs_reconnect" }`
 *   (the pane shows "Needs to reconnect", never an empty week)
 * - `ProviderThrottledError` → 503 `{ error: "throttled" }` ("the provider is busy",
 *   never "no meetings")
 * - `ProviderRequestError` 403 / 404 → the same status, `not_allowed` / `not_found`
 * - access denials → `authErrorResponse`
 * - anything else → 500, logging only `safeErrorFields` (`invalid_client` is
 *   an expired secret, not an outage). Never `err.message`: a rethrown DB
 *   error's message carries query parameters (encrypted tokens, email,
 *   provider user id).
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
  if (err instanceof ProviderThrottledError) {
    return NextResponse.json({ error: "throttled" }, { status: 503 });
  }
  if (err instanceof ProviderRequestError && err.status === 403) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }
  if (err instanceof ProviderRequestError && err.status === 404) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  console.error("Workspace route error:", safeErrorFields(err));
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/**
 * All a log line may carry: the error's name; for a provider error, the
 * provider plus a request error's status, request id and code; for a sign-in error,
 * the provider and its short `code`.
 */
export function safeErrorFields(err: unknown): {
  name: string;
  provider?: WorkspaceProvider;
  status?: number;
  requestId?: string | null;
  code?: string;
} {
  return {
    name: err instanceof Error ? err.name : typeof err,
    ...(err instanceof ProviderThrottledError ? { provider: err.provider } : {}),
    ...(err instanceof ProviderRequestError
      ? {
          provider: err.provider,
          status: err.status,
          requestId: err.requestId,
          // Google sends no request id, so the code is the only reason a failure logs.
          ...(err.code ? { code: err.code } : {}),
        }
      : {}),
    ...(err instanceof MicrosoftAuthError ? { provider: "microsoft" as const, code: err.code } : {}),
    ...(err instanceof GoogleAuthError ? { provider: "google" as const, code: err.code } : {}),
  };
}

/** A redirect to an app path, for routes a browser navigates to. */
export function redirectTo(req: Request, path: string): Response {
  return NextResponse.redirect(new URL(path, req.url), 307);
}

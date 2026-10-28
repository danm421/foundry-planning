// src/lib/workspace/errors.ts
import type { CalendarPaneState } from "./types";

/**
 * The advisor can't use Workspace yet: the firm hasn't approved the provider,
 * their switch is off, or they haven't signed in. `state` is the Calendar
 * pane's state, which the route returns as its 409 body.
 */
export class WorkspaceNotConnectedError extends Error {
  constructor(public readonly state: Exclude<CalendarPaneState, "ready" | "needs_reconnect">) {
    super(`Workspace is not connected: ${state}`);
    this.name = "WorkspaceNotConnectedError";
  }
}

/** The advisor's Microsoft sign-in was revoked or expired; they must sign in again. */
export class WorkspaceReconnectRequiredError extends Error {
  constructor() {
    super("Workspace connection needs to be reconnected");
    this.name = "WorkspaceReconnectRequiredError";
  }
}

/**
 * Microsoft Graph kept answering 429/503/504 after our retries. "Microsoft is
 * busy", never "nothing there". `requestId` is Graph's `request-id` header.
 */
export class GraphThrottledError extends Error {
  constructor(public readonly requestId: string | null) {
    super("Microsoft Graph is throttling or unavailable");
    this.name = "GraphThrottledError";
  }
}

/**
 * Any other non-2xx from Graph. `graphCode` is Graph's `error.code`; the
 * response body (whose `error.message` can quote mailbox content) is never
 * kept. `requestId` is Graph's `request-id` header, for Microsoft support.
 */
export class GraphRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly graphCode: string | null,
    public readonly requestId: string | null,
  ) {
    super(`Microsoft Graph request failed (HTTP ${status})${graphCode ? `: ${graphCode}` : ""}`);
    this.name = "GraphRequestError";
  }
}

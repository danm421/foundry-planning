// src/lib/workspace/errors.ts
import type { CalendarPaneState, WorkspaceProvider } from "./types";

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

const PROVIDER_NAME: Record<WorkspaceProvider, string> = { microsoft: "Microsoft", google: "Google" };

/**
 * The provider kept answering 429/503/504 after our retries. "The provider is
 * busy", never "nothing there". `requestId` is the provider's request-id header.
 */
export class ProviderThrottledError extends Error {
  constructor(
    public readonly provider: WorkspaceProvider,
    public readonly requestId: string | null,
  ) {
    super(`${PROVIDER_NAME[provider]} is throttling or unavailable`);
    this.name = "ProviderThrottledError";
  }
}

/**
 * Any other non-2xx from the provider. `code` is the provider's error code; the
 * response body (whose message can quote mailbox content) is never kept.
 * `requestId` is the provider's request-id header, for their support.
 */
export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: WorkspaceProvider,
    public readonly status: number,
    public readonly code: string | null,
    public readonly requestId: string | null,
  ) {
    super(`${PROVIDER_NAME[provider]} request failed (HTTP ${status})${code ? `: ${code}` : ""}`);
    this.name = "ProviderRequestError";
  }
}

// src/lib/workspace/errors.ts
import type { WorkspaceProvider } from "./types";

/**
 * The advisor has no connected account yet. `state` is the Calendar pane's
 * state, which the route returns as its 409 body.
 */
export class WorkspaceNotConnectedError extends Error {
  constructor(public readonly state: "connect") {
    super(`Workspace is not connected: ${state}`);
    this.name = "WorkspaceNotConnectedError";
  }
}

/**
 * An ops "sign in as" session (a Clerk `actor` claim). Workspace never shows
 * or changes an advisor's provider data for Foundry staff.
 */
export class WorkspaceImpersonationError extends Error {
  constructor() {
    super("Workspace is unavailable while signed in as someone else");
    this.name = "WorkspaceImpersonationError";
  }
}

/** No connection by that id belongs to the signed-in advisor (or none exists). */
export class WorkspaceConnectionNotFoundError extends Error {
  constructor() {
    super("Workspace connection not found");
    this.name = "WorkspaceConnectionNotFoundError";
  }
}

/** The account's sign-in was revoked or expired; the advisor must sign in again. */
export class WorkspaceReconnectRequiredError extends Error {
  constructor() {
    super("Workspace connection needs to be reconnected");
    this.name = "WorkspaceReconnectRequiredError";
  }
}

const PROVIDER_NAME: Record<WorkspaceProvider, string> = { microsoft: "Microsoft", google: "Google" };

/**
 * The provider kept answering "busy" after our retries: Microsoft's
 * 429/503/504; Google's 429/500/502/503/504 or a rate-limit 403 (each client
 * keeps its own set). "The provider is busy", never "nothing there".
 * `requestId` is the provider's request-id header (Google sends none).
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

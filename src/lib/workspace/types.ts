// src/lib/workspace/types.ts

/** A Microsoft identity-platform token response, normalized. */
export type MicrosoftTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string;
  idToken: string | null;
};

/** The id_token claims Foundry keys a connection on (`tid`, `oid`, `preferred_username`). */
export type IdTokenClaims = {
  tenantId: string;
  userObjectId: string;
  email: string;
};

export type WorkspaceProvider = "microsoft";

/** One person's state for a provider, as the firm roster shows it. */
export type MemberStatus = "off" | "not_connected" | "connected" | "needs_reconnect";

/** What the Calendar pane renders for the signed-in advisor. */
export type CalendarPaneState =
  | "firm_not_approved"
  | "member_off"
  | "connect"
  | "needs_reconnect"
  | "ready";

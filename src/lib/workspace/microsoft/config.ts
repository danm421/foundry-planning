// src/lib/workspace/microsoft/config.ts
import { requireEnv } from "@/lib/integrations/env";

/**
 * Delegated scopes only — nothing app-only, so Foundry can never read a
 * mailbox the signed-in advisor can't. Admin consent grants exactly these.
 */
export const MICROSOFT_SCOPES: readonly string[] = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "Tasks.ReadWrite",
  "MailboxSettings.Read",
];

/** OIDC scopes go bare; every other scope is a Microsoft Graph permission. */
const OIDC_SCOPES = new Set(["openid", "profile", "offline_access"]);
const GRAPH_RESOURCE = "https://graph.microsoft.com/";

export const ADMIN_CONSENT_REDIRECT_PATH = "/api/workspace/microsoft/admin-consent/callback";
export const USER_REDIRECT_PATH = "/api/workspace/microsoft/callback";

/** The `scope` parameter: Graph scopes fully qualified, OIDC scopes bare. */
export function graphScopeParam(): string {
  return MICROSOFT_SCOPES.map((s) => (OIDC_SCOPES.has(s) ? s : GRAPH_RESOURCE + s)).join(" ");
}

export function microsoftAppConfig(): { clientId: string; clientSecret: string; appUrl: string } {
  return {
    clientId: requireEnv("MICROSOFT_CLIENT_ID"),
    clientSecret: requireEnv("MICROSOFT_CLIENT_SECRET"),
    // No prod fallback (unlike the mailers): a redirect URI pointing at the
    // wrong host fails Microsoft's exact-match check far less legibly.
    appUrl: requireEnv("NEXT_PUBLIC_APP_URL"),
  };
}

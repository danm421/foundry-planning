// src/lib/workspace/google/config.ts
import { requireEnv } from "@/lib/integrations/env";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

/**
 * Sign-in plus the two data scopes Workspace uses. Nothing restricted (no
 * Gmail, no Drive), and `calendar.events` reaches events only, not calendar
 * settings or sharing.
 */
export const GOOGLE_SCOPES: readonly string[] = [
  "openid",
  "email",
  "profile",
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TASKS_SCOPE,
];

export const GOOGLE_USER_REDIRECT_PATH = "/api/workspace/google/callback";

/** Google is offered only when both halves of the OAuth client are set. */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAppConfig(): { clientId: string; clientSecret: string; appUrl: string } {
  return {
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    // No prod fallback: a redirect URI on the wrong host fails Google's
    // exact-match check far less legibly than a missing env var.
    appUrl: requireEnv("NEXT_PUBLIC_APP_URL"),
  };
}

// src/lib/notifications/prefs.ts
//
// Merge a user's partial stored preference map onto the defaults, and turn a
// merged map into the two booleans a notification row carries. Pure.
import {
  NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationCategory,
  type NotificationChannelPref,
  type NotificationPrefsMap,
} from "./catalog";

/**
 * What is actually in the jsonb column: a PARTIAL map, possibly written by an
 * older build. Keys may name categories that no longer exist and values may be
 * partial or the wrong type, so every field is re-validated on read.
 */
export type StoredPrefs = Partial<Record<string, Partial<NotificationChannelPref>>>;

/**
 * Defaults for anything absent. Storing partials rather than full maps is what
 * lets a NEW category inherit its shipped default for existing users instead of
 * reading as "off" because their row predates it.
 */
export function mergePrefs(stored: StoredPrefs | null | undefined): NotificationPrefsMap {
  const out = {} as NotificationPrefsMap;
  for (const cat of NOTIFICATION_CATEGORIES) {
    const d = DEFAULT_NOTIFICATION_PREFS[cat];
    const s = stored?.[cat];
    out[cat] = {
      inApp: typeof s?.inApp === "boolean" ? s.inApp : d.inApp,
      email: typeof s?.email === "boolean" ? s.email : d.email,
    };
  }
  return out;
}

export function decideRouting(
  prefs: NotificationPrefsMap,
  category: NotificationCategory,
): { inApp: boolean; emailPending: boolean } {
  const p = prefs[category];
  return { inApp: p.inApp, emailPending: p.email };
}

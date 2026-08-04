// src/lib/notifications/settings-payload.ts
//
// Translate the Settings tab's FormData into the jsonb shape the preferences
// row stores. Pure, so the checkbox semantics are testable without a form or a
// database.
import {
  NOTIFICATION_CATEGORIES,
  DATE_DIGEST_CADENCES,
  DEFAULT_DATE_DIGEST_CADENCE,
  type DateDigestCadence,
  type NotificationPrefsMap,
} from "./catalog";

/**
 * Iterates the CATALOG, not the form's keys. An unchecked checkbox is absent
 * from FormData entirely rather than present-and-false, so a parser driven by
 * the submitted keys could only ever turn things ON — every "off" would
 * silently revert to the stored value on save.
 *
 * The result is a FULL map (`NotificationPrefsMap`), not the partial
 * `StoredPrefs` the column can also hold. That is correct here: the user just
 * saw and decided every toggle, so their choices are explicit from now on.
 * Typing it as the full map is also what lets it flow straight into the
 * `channels` column, whose declared type is keyed on NotificationCategory.
 */
export function parseSettingsPayload(form: FormData): {
  channels: NotificationPrefsMap;
  cadence: DateDigestCadence;
} {
  const channels = {} as NotificationPrefsMap;
  for (const category of NOTIFICATION_CATEGORIES) {
    channels[category] = {
      inApp: form.get(`inApp:${category}`) !== null,
      email: form.get(`email:${category}`) !== null,
    };
  }

  const raw = form.get("dateDigestCadence");
  const cadence =
    DATE_DIGEST_CADENCES.find((c) => c === raw) ?? DEFAULT_DATE_DIGEST_CADENCE;

  return { channels, cadence };
}

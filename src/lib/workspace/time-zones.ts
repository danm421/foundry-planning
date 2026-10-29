// src/lib/workspace/time-zones.ts
import { IANA_TO_WINDOWS, WINDOWS_TO_IANA } from "./windows-zones";

/**
 * Microsoft Graph names zones the Windows way ("Central Standard Time"); Google
 * and `Intl` use IANA ids. An id with a `/` is already IANA and passes through.
 */
export function windowsToIana(name: string): string | null {
  if (name === "UTC") return "UTC";
  if (name.includes("/")) return name;
  return WINDOWS_TO_IANA[name] ?? null;
}

/** Unknown zones come back unchanged so the caller can still send something. */
export function ianaToWindows(zone: string): string {
  if (zone === "UTC") return "UTC";
  return IANA_TO_WINDOWS[zone] ?? zone;
}

export function isValidIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** "Central Time" rather than "CST", so it reads the same in winter and summer. */
export function zoneLabel(zone: string): string {
  if (zone === "UTC") return "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longGeneric",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? zone;
}

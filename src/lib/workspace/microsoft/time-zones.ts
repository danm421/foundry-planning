// src/lib/workspace/microsoft/time-zones.ts
import { IANA_TO_WINDOWS, WINDOWS_TO_IANA } from "../windows-zones";

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

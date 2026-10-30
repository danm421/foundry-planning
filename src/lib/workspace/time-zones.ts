// src/lib/workspace/time-zones.ts
// Intl only: the Workspace page imports this, so Graph's Windows zone table
// (and `windowsToIana` / `ianaToWindows`) stays in `./microsoft/time-zones`.

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

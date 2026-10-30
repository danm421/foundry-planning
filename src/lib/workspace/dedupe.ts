// src/lib/workspace/dedupe.ts

/** Outlook's UID prefix: the OLE class id of an Outlook-generated global object id. */
const OUTLOOK_CLASS_ID = "040000008200E00074C5B7101A82E008";

/**
 * Google and Outlook name the same meeting differently: Outlook re-wraps an
 * external UID ("vCal-Uid") inside its own binary id, and stamps its own ids
 * with the occurrence date. Reduce both to one comparable string.
 */
export function normalizeUid(uid: string): string {
  const hex = uid.trim();
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 && hex.toUpperCase().startsWith(OUTLOOK_CLASS_ID)) {
    const bytes = Buffer.from(hex, "hex");
    // A truncated id (an outsider's invite can carry just the class id) has no
    // instance date to zero; treat it as an ordinary UID rather than throw.
    if (bytes.length < 20) return hex;
    // Bytes 40-47 spell "vCal-Uid" when Outlook wrapped an external UID; the
    // UID itself starts after a 4-byte version at byte 52 and ends at a NUL.
    if (bytes.length > 52 && bytes.subarray(40, 48).toString("ascii") === "vCal-Uid") {
      const end = bytes.indexOf(0, 52);
      return bytes.subarray(52, end === -1 ? bytes.length : end).toString("utf8");
    }
    // Outlook's own id: bytes 16-19 are the instance date. Zero them so an
    // occurrence matches its series.
    bytes.fill(0, 16, 20);
    return bytes.toString("hex").toUpperCase();
  }
  return hex;
}

/**
 * A meeting on two of an advisor's calendars should show once. Events group by
 * normalized UID plus start; the organizer's copy wins, otherwise the account
 * listed first. Events with no UID (or one that normalizes to nothing), or
 * with two copies inside one account (separate events that happen to share a
 * UID), are never merged.
 */
export function dedupeEvents<
  E extends { iCalUid: string | null; start: string; isOrganizer: boolean; connectionId: string },
>(events: E[], accountOrder: string[]): E[] {
  const keyOf = (e: E) => {
    const uid = e.iCalUid && normalizeUid(e.iCalUid);
    return uid ? `${uid}|${e.start}` : null;
  };
  const groups = new Map<string, E[]>();
  for (const e of events) {
    const key = keyOf(e);
    if (key) groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const rank = (e: E) => {
    const i = accountOrder.indexOf(e.connectionId);
    return i === -1 ? accountOrder.length : i;
  };
  const winnerOf = (group: E[]) =>
    group.reduce((best, e) => {
      if (e.isOrganizer !== best.isOrganizer) return e.isOrganizer ? e : best;
      return rank(e) < rank(best) ? e : best;
    });

  const winners = new Set<E>();
  for (const group of groups.values()) {
    const sameAccountTwice = new Set(group.map((e) => e.connectionId)).size < group.length;
    if (group.length > 1 && !sameAccountTwice) winners.add(winnerOf(group));
    else group.forEach((e) => winners.add(e));
  }

  return events.filter((e) => keyOf(e) === null || winners.has(e));
}

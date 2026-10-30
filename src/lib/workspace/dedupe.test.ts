import { describe, it, expect } from "vitest";
import { dedupeEvents, normalizeUid } from "./dedupe";

const CLASS_ID = "040000008200E00074C5B7101A82E008";

function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Outlook's wrapper around an external UID: class id, 4 zero bytes, 16 zero bytes, LE length, "vCal-Uid", version, UID, NUL. */
function wrappedUid(uid: string): string {
  const body = [
    ...Buffer.from("vCal-Uid", "ascii"),
    1, 0, 0, 0,
    ...Buffer.from(uid, "utf8"),
    0,
  ];
  const len = body.length;
  const lenLe = [len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff];
  return CLASS_ID + hex([0, 0, 0, 0, ...new Array(16).fill(0), ...lenLe, ...body]);
}

/** Outlook's own UID: class id, then 4 instance-date bytes, 8 more header bytes, length, data. */
function ownUid(instance: number[]): string {
  return CLASS_ID + hex([...instance, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4]);
}

const ev = (over: Partial<{ iCalUid: string | null; start: string; isOrganizer: boolean; connectionId: string }>) => ({
  iCalUid: "abc123@google.com" as string | null,
  start: "2026-11-02T09:00",
  isOrganizer: false,
  connectionId: "g",
  ...over,
});

describe("normalizeUid", () => {
  it("unwraps an external UID that Outlook wrapped", () => {
    expect(normalizeUid(wrappedUid("abc123@google.com"))).toBe("abc123@google.com");
  });
  it("zeroes the instance date of Outlook's own UIDs and upper-cases", () => {
    const occurrence = ownUid([0x07, 0xea, 0x0b, 0x02]).toLowerCase();
    const series = ownUid([0, 0, 0, 0]);
    expect(normalizeUid(occurrence)).toBe(normalizeUid(series));
    expect(normalizeUid(occurrence)).toBe(series.toUpperCase());
  });
  it("does not throw on a truncated Outlook-prefixed UID", () => {
    const bare = CLASS_ID; // 16 bytes
    const short = CLASS_ID + "070000"; // 19 bytes
    const midWrapped = CLASS_ID + hex([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...Buffer.from("vCal-Uid", "ascii")]); // 48 bytes
    expect(normalizeUid(bare)).toBe(bare);
    expect(normalizeUid(short)).toBe(short);
    expect(() => normalizeUid(midWrapped)).not.toThrow();
  });
  it("leaves other UIDs alone, trimmed", () => {
    expect(normalizeUid("  abc123@google.com ")).toBe("abc123@google.com");
  });
});

describe("dedupeEvents", () => {
  const order = ["g", "m"];
  it("keeps the first account's copy of a meeting on two calendars", () => {
    const out = dedupeEvents(
      [ev({}), ev({ iCalUid: wrappedUid("abc123@google.com"), connectionId: "m" })],
      order,
    );
    expect(out).toHaveLength(1);
    expect(out[0].connectionId).toBe("g");
  });
  it("prefers the organizer's copy", () => {
    const out = dedupeEvents(
      [ev({}), ev({ iCalUid: wrappedUid("abc123@google.com"), connectionId: "m", isOrganizer: true })],
      order,
    );
    expect(out).toHaveLength(1);
    expect(out[0].connectionId).toBe("m");
  });
  it("keeps every event when one has a truncated Outlook UID", () => {
    const events = [ev({}), ev({ iCalUid: CLASS_ID + "07", connectionId: "m" })];
    expect(dedupeEvents(events, order)).toHaveLength(2);
  });
  it("keeps both when the start differs", () => {
    const out = dedupeEvents([ev({}), ev({ connectionId: "m", start: "2026-11-03T09:00" })], order);
    expect(out).toHaveLength(2);
  });
  it("never groups events without a UID", () => {
    const out = dedupeEvents([ev({ iCalUid: null }), ev({ iCalUid: null, connectionId: "m" })], order);
    expect(out).toHaveLength(2);
  });
  it("(M1) never groups events whose UID normalizes to nothing", () => {
    const blank = dedupeEvents([ev({ iCalUid: "   " }), ev({ iCalUid: "\t", connectionId: "m" })], order);
    expect(blank.map((e) => e.connectionId)).toEqual(["g", "m"]);
    // An Outlook wrapper whose external UID is empty (a NUL straight after the version).
    const empty = dedupeEvents([ev({ iCalUid: wrappedUid("") }), ev({ iCalUid: wrappedUid(""), connectionId: "m" })], order);
    expect(empty).toHaveLength(2);
  });
  it("never merges two events from the same connection", () => {
    expect(dedupeEvents([ev({}), ev({})], order)).toHaveLength(2);
  });
});

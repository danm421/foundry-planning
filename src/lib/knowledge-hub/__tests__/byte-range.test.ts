// src/lib/knowledge-hub/__tests__/byte-range.test.ts
import { describe, it, expect } from "vitest";
import { MAX_CHUNK_BYTES, parseByteRange } from "../byte-range";

const SIZE = 6_160_000;

describe("parseByteRange", () => {
  it("serves Safari's 2-byte probe exactly", () => {
    expect(parseByteRange("bytes=0-1", SIZE)).toEqual({ start: 0, end: 1 });
  });

  it("caps an open-ended range at 2 MB", () => {
    expect(parseByteRange("bytes=0-", SIZE)).toEqual({ start: 0, end: MAX_CHUNK_BYTES - 1 });
  });

  it("ends a range near the tail at the last byte", () => {
    expect(parseByteRange(`bytes=${SIZE - 100}-`, SIZE)).toEqual({ start: SIZE - 100, end: SIZE - 1 });
  });

  it("serves a suffix range", () => {
    expect(parseByteRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("treats a missing or malformed header as bytes=0-", () => {
    expect(parseByteRange(null, 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange("pages=1", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("uses only the first of several ranges", () => {
    expect(parseByteRange("bytes=0-1,5-9", 1000)).toEqual({ start: 0, end: 1 });
  });

  it("returns null for an unsatisfiable range", () => {
    expect(parseByteRange("bytes=2000-", 1000)).toBeNull();
    expect(parseByteRange("bytes=10-5", 1000)).toBeNull();
  });
});

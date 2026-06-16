import { describe, it, expect } from "vitest";
import { chunkText, contentHash } from "../chunk";

describe("chunkText", () => {
  it("is deterministic for fixed params", () => {
    const body = "word ".repeat(500).trim();
    const a = chunkText(body, { size: 200, overlap: 40 });
    const b = chunkText(body, { size: 200, overlap: 40 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
  });
  it("overlaps adjacent chunks", () => {
    const body = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkText(body, { size: 100, overlap: 20 });
    const tail = chunks[0].split(" ").slice(-20).join(" ");
    expect(chunks[1].startsWith(tail)).toBe(true);
  });
});

describe("contentHash", () => {
  it("is stable for identical text and differs otherwise", () => {
    expect(contentHash("abc")).toEqual(contentHash("abc"));
    expect(contentHash("abc")).not.toEqual(contentHash("abd"));
  });
});

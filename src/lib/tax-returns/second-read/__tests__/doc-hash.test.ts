import { describe, it, expect } from "vitest";
import { secondReadDocHash } from "../doc-hash";

describe("secondReadDocHash", () => {
  it("is stable across query order — the same set hashes the same", () => {
    expect(secondReadDocHash(["b", "a", "c"])).toBe(secondReadDocHash(["a", "b", "c"]));
  });

  it("changes when a document is added", () => {
    expect(secondReadDocHash(["a", "b"])).not.toBe(secondReadDocHash(["a", "b", "c"]));
  });

  it("changes when a document is removed", () => {
    expect(secondReadDocHash(["a", "b"])).not.toBe(secondReadDocHash(["a"]));
  });

  it("hashes the empty set to a real value rather than throwing", () => {
    expect(secondReadDocHash([])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cannot be fooled by ids that concatenate to the same string", () => {
    // Without a separator, ["ab","c"] and ["a","bc"] would both be "abc".
    expect(secondReadDocHash(["ab", "c"])).not.toBe(secondReadDocHash(["a", "bc"]));
  });
});

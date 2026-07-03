import { describe, it, expect } from "vitest";
import {
  mentionToken,
  splitMentionSegments,
  extractMentionUserIds,
  insertMentionTokens,
  findMentionQuery,
} from "./mentions";

describe("mentionToken", () => {
  it("serializes name + id", () => {
    expect(mentionToken("Jane Smith", "user_2abc")).toBe("@[Jane Smith](user:user_2abc)");
  });
  it("sanitizes brackets and newlines out of the name", () => {
    expect(mentionToken("Ja]ne\n[S", "u1")).toBe("@[Ja ne S](user:u1)");
  });
  it("caps the name at 80 chars so the token always round-trips", () => {
    const long = "x".repeat(100);
    const token = mentionToken(long, "u1");
    expect(splitMentionSegments(token)).toEqual([
      { kind: "mention", displayName: "x".repeat(80), userId: "u1" },
    ]);
  });
});

describe("splitMentionSegments", () => {
  it("round-trips a token with surrounding text", () => {
    const body = `ping ${mentionToken("Jane Smith", "user_2abc")} about the IRA`;
    expect(splitMentionSegments(body)).toEqual([
      { kind: "text", text: "ping " },
      { kind: "mention", displayName: "Jane Smith", userId: "user_2abc" },
      { kind: "text", text: " about the IRA" },
    ]);
  });
  it("handles adjacent mentions and mention-at-start/end", () => {
    const body = `${mentionToken("A B", "u1")}${mentionToken("C D", "u2")}`;
    expect(splitMentionSegments(body)).toEqual([
      { kind: "mention", displayName: "A B", userId: "u1" },
      { kind: "mention", displayName: "C D", userId: "u2" },
    ]);
  });
  it("leaves malformed tokens as text", () => {
    for (const bad of ["@[Jane](user:)", "@[](user:u1)", "@[Jane]", "@[Ja\nne](user:u1)"]) {
      expect(splitMentionSegments(bad)).toEqual([{ kind: "text", text: bad }]);
    }
  });
});

describe("extractMentionUserIds", () => {
  it("dedupes and preserves order", () => {
    const body = `${mentionToken("A", "u1")} x ${mentionToken("B", "u2")} y ${mentionToken("A", "u1")}`;
    expect(extractMentionUserIds(body)).toEqual(["u1", "u2"]);
  });
  it("returns [] for plain text", () => {
    expect(extractMentionUserIds("no mentions @here")).toEqual([]);
  });
});

describe("insertMentionTokens", () => {
  const jane = { displayName: "Jane Smith", userId: "u_jane" };
  it("replaces every @Name occurrence", () => {
    expect(insertMentionTokens("@Jane Smith and again @Jane Smith", [jane])).toBe(
      "@[Jane Smith](user:u_jane) and again @[Jane Smith](user:u_jane)",
    );
  });
  it("prefers the longest name when one is a prefix of another", () => {
    const j = { displayName: "Jane", userId: "u_j" };
    expect(insertMentionTokens("@Jane Smith + @Jane", [j, jane])).toBe(
      "@[Jane Smith](user:u_jane) + @[Jane](user:u_j)",
    );
  });
  it("does not match a longer word (no partial names)", () => {
    expect(insertMentionTokens("@Jane Smithson", [jane])).toBe("@Jane Smithson");
  });
  it("leaves an edited name as plain text", () => {
    expect(insertMentionTokens("@Jane Smyth", [jane])).toBe("@Jane Smyth");
  });
  it("escapes regex specials in names", () => {
    const odd = { displayName: "A (Ops) + B", userId: "u_odd" };
    expect(insertMentionTokens("cc @A (Ops) + B now", [odd])).toBe(
      "cc @[A (Ops) + B](user:u_odd) now",
    );
  });
  it("first pick wins on duplicate display names", () => {
    const a = { displayName: "Sam Lee", userId: "u_a" };
    const b = { displayName: "Sam Lee", userId: "u_b" };
    expect(insertMentionTokens("@Sam Lee", [a, b])).toBe("@[Sam Lee](user:u_a)");
  });
});

describe("findMentionQuery", () => {
  it("finds @ at start of text", () => {
    expect(findMentionQuery("@ja", 3)).toEqual({ start: 0, query: "ja" });
  });
  it("finds @ after whitespace, query may contain a space", () => {
    expect(findMentionQuery("hi @jane s", 10)).toEqual({ start: 3, query: "jane s" });
  });
  it("rejects @ inside a word (emails)", () => {
    expect(findMentionQuery("dan@gmail", 9)).toBeNull();
  });
  it("rejects when the query crosses a newline", () => {
    expect(findMentionQuery("@ja\nne", 6)).toBeNull();
  });
  it("rejects queries over 40 chars", () => {
    expect(findMentionQuery("@" + "x".repeat(41), 42)).toBeNull();
  });
  it("returns null when there is no @ before the caret", () => {
    expect(findMentionQuery("hello", 5)).toBeNull();
  });
});

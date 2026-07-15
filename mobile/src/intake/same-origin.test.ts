import { describe, it, expect } from "vitest";
import { isSameOriginUrl } from "./same-origin";

const BASE = "https://app.example.com";

describe("isSameOriginUrl", () => {
  it("matches the exact base origin", () => {
    expect(isSameOriginUrl("https://app.example.com", BASE)).toBe(true);
  });

  it("matches a path under the base origin", () => {
    expect(isSameOriginUrl("https://app.example.com/portal/intake", BASE)).toBe(true);
  });

  it("matches a query string on the base origin", () => {
    expect(isSameOriginUrl("https://app.example.com?x=1", BASE)).toBe(true);
  });

  it("matches a hash fragment on the base origin", () => {
    expect(isSameOriginUrl("https://app.example.com#a", BASE)).toBe(true);
  });

  it("rejects a domain-suffix bypass", () => {
    expect(isSameOriginUrl("https://app.example.com.evil.com/phish", BASE)).toBe(false);
  });

  it("rejects a userinfo bypass", () => {
    expect(isSameOriginUrl("https://app.example.com@evil.com/phish", BASE)).toBe(false);
  });

  it("rejects an unrelated origin", () => {
    expect(isSameOriginUrl("https://evil.com/", BASE)).toBe(false);
  });
});

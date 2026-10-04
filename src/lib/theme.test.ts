import { describe, it, expect } from "vitest";
import { resolveTheme, THEME_COOKIE } from "./theme";

describe("resolveTheme", () => {
  it("defaults to dark when cookie absent", () => expect(resolveTheme(undefined)).toBe("dark"));
  it("returns each known theme verbatim", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
  it("moves a legacy industrial cookie onto dark", () =>
    expect(resolveTheme("industrial")).toBe("dark"));
  it("falls back to dark for an unknown cookie", () =>
    expect(resolveTheme("garbage")).toBe("dark"));
  it("exposes a stable cookie name", () => expect(THEME_COOKIE).toBe("theme"));
});

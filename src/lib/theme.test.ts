import { describe, it, expect } from "vitest";
import { resolveTheme, THEME_COOKIE } from "./theme";

describe("resolveTheme", () => {
  it("defaults to dark when cookie absent", () => expect(resolveTheme(undefined)).toBe("dark"));
  it("returns light only for the literal 'light'", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("garbage")).toBe("dark");
  });
  it("exposes a stable cookie name", () => expect(THEME_COOKIE).toBe("theme"));
});

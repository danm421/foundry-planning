import { describe, it, expect } from "vitest";
import { resolveTheme, isDarkTheme, paletteTheme, THEME_COOKIE } from "./theme";

describe("resolveTheme", () => {
  it("defaults to industrial when cookie absent", () =>
    expect(resolveTheme(undefined)).toBe("industrial"));
  it("returns each known theme verbatim", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("industrial")).toBe("industrial");
  });
  it("falls back to industrial for an unknown cookie", () =>
    expect(resolveTheme("garbage")).toBe("industrial"));
  it("exposes a stable cookie name", () => expect(THEME_COOKIE).toBe("theme"));
});

describe("theme classification", () => {
  it("treats industrial as a dark surface", () => {
    // Clerk's appearance and the chart palettes both split two ways, so the
    // new default must land on the dark side of each or the sign-in card and
    // every chart render light-on-light.
    expect(isDarkTheme("industrial")).toBe(true);
    expect(paletteTheme("industrial")).toBe("dark");
  });
  it("keeps light on the light side", () => {
    expect(isDarkTheme("light")).toBe(false);
    expect(paletteTheme("light")).toBe("light");
  });
});

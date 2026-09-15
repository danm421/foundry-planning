import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dataScale, data, dataLight, colorsLight } from "./index";

describe("dataScale", () => {
  it("returns exactly n colors", () => {
    expect(dataScale(12, "dark")).toHaveLength(12);
    expect(dataScale(3, "light")).toHaveLength(3);
  });
  it("emits oklch() strings", () => {
    for (const c of dataScale(5, "dark")) expect(c.startsWith("oklch(")).toBe(true);
  });
  it("never lands a hue in the reserved accent-verdigris band (165–195°)", () => {
    const hues = dataScale(24, "dark").map((c) => Number(c.match(/oklch\([^ ]+ [^ ]+ ([\d.]+)\)/)![1]));
    expect(hues.some((h) => h > 165 && h < 195)).toBe(false);
  });
  it("exposes the 10 named hues per theme, with the same keys in both", () => {
    // Six anchors + four fills. The count is a tripwire on the palette being
    // extended in one theme and not the other, which is the shape a chart
    // reading `dataLight.sky` would crash on in light mode alone.
    expect(Object.keys(data)).toHaveLength(10);
    expect(Object.keys(dataLight)).toEqual(Object.keys(data));
  });
});

describe("--color-letterhead", () => {
  // The plate an uploaded firm logo stands on. Its whole justification is that
  // it equals the cream every client report already prints that same logo on,
  // so a seam opens between the app and the downloaded PDF the moment the two
  // drift. globals.css is the canonical side and cannot import from here, so
  // the equality is asserted rather than derived.
  it("matches the light-palette paper the PDFs print the logo on", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const declared = css.match(/--color-letterhead:\s*(#[0-9a-f]{3,8});/i)?.[1];
    expect(declared).toBe(colorsLight.paper);
  });

  it("is declared exactly once, so no theme block can re-cut it", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    // The `@theme inline` block re-exports it to Tailwind as a var() alias;
    // that is a mapping, not a second value, so only literal values count.
    const literals = css.match(/--color-letterhead:\s*#[0-9a-f]{3,8};/gi) ?? [];
    expect(literals).toHaveLength(1);
  });
});

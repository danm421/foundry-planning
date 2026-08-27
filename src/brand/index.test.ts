import { describe, it, expect } from "vitest";
import { dataScale, data, dataLight } from "./index";

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

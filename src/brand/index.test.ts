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
  it("exposes the 9 named hues per theme", () => {
    expect(Object.keys(data)).toHaveLength(9);
    expect(Object.keys(dataLight)).toHaveLength(9);
  });
});

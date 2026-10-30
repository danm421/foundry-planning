import { describe, it, expect } from "vitest";
import { isValidIanaZone, zoneLabel } from "./time-zones";

describe("isValidIanaZone", () => {
  it("accepts IANA ids and rejects Windows names", () => {
    expect(isValidIanaZone("America/Chicago")).toBe(true);
    expect(isValidIanaZone("Central Standard Time")).toBe(false);
  });
});

describe("zoneLabel", () => {
  it("names the zone generically", () => {
    expect(zoneLabel("America/Chicago")).toBe("Central Time");
    expect(zoneLabel("UTC")).toBe("UTC");
  });
});

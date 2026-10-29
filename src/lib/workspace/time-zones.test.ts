import { describe, it, expect } from "vitest";
import { windowsToIana, ianaToWindows, isValidIanaZone, zoneLabel } from "./time-zones";

describe("windowsToIana", () => {
  it("maps Windows names to IANA", () => {
    expect(windowsToIana("Central Standard Time")).toBe("America/Chicago");
    expect(windowsToIana("Eastern Standard Time")).toBe("America/New_York");
  });
  it("passes IANA ids and UTC through", () => {
    expect(windowsToIana("America/Denver")).toBe("America/Denver");
    expect(windowsToIana("UTC")).toBe("UTC");
  });
  it("returns null for an unknown name", () => {
    expect(windowsToIana("Nowhere Standard Time")).toBeNull();
  });
});

describe("ianaToWindows", () => {
  it("maps IANA ids to Windows names", () => {
    expect(ianaToWindows("America/Chicago")).toBe("Central Standard Time");
    expect(ianaToWindows("America/Indiana/Indianapolis")).toBe("US Eastern Standard Time");
  });
  it("returns unknown input unchanged", () => {
    expect(ianaToWindows("Etc/Unknown")).toBe("Etc/Unknown");
  });
  it("keeps UTC as UTC", () => {
    expect(ianaToWindows("UTC")).toBe("UTC");
  });
});

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

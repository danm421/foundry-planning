import { describe, expect, it } from "vitest";
import { getProvider, isProviderId, listProviders } from "./registry";

describe("provider registry", () => {
  it("resolves orion", () => {
    expect(getProvider("orion").id).toBe("orion");
    expect(getProvider("orion").label).toBe("Orion Advisor Tech");
  });

  it("resolves schwab", () => {
    expect(getProvider("schwab").id).toBe("schwab");
    expect(getProvider("schwab").label).toBe("Schwab Advisor Services");
  });

  it("narrows valid ids and rejects unknown ones", () => {
    expect(isProviderId("orion")).toBe(true);
    expect(isProviderId("addepar")).toBe(false);
    expect(isProviderId("")).toBe(false);
  });

  it("lists every registered provider", () => {
    expect(listProviders().map((p) => p.id).sort()).toEqual(["orion", "schwab"]);
  });
});

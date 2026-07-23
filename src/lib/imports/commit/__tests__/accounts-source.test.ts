import { describe, it, expect } from "vitest";
import { externalProviderToSource } from "../accounts";

describe("externalProviderToSource", () => {
  it("maps known providers to their source value", () => {
    expect(externalProviderToSource("addepar")).toBe("addepar");
    expect(externalProviderToSource("orion")).toBe("orion");
    expect(externalProviderToSource("schwab")).toBe("schwab");
  });
  it("falls back to extracted when no external provider", () => {
    expect(externalProviderToSource(null)).toBe("extracted");
    expect(externalProviderToSource(undefined)).toBe("extracted");
  });
});

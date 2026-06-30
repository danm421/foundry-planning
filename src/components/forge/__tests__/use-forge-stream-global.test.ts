import { describe, it, expect } from "vitest";
import { forgeApiBase } from "../use-forge-stream";

describe("forgeApiBase", () => {
  it("uses the global base when clientId is null", () => {
    expect(forgeApiBase(null)).toBe("/api/forge");
  });
  it("uses the client base when a clientId is present", () => {
    expect(forgeApiBase("abc")).toBe("/api/clients/abc/forge");
  });
});

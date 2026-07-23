import { describe, it, expect } from "vitest";
import {
  encodeAddeparSecret, decodeAddeparSecret,
  encodeAddeparConfig, decodeAddeparConfig,
} from "./credentials";

describe("addepar credential codec", () => {
  it("round-trips the secret", () => {
    const s = { apiKey: "key_123", apiSecret: "sec_456" };
    expect(decodeAddeparSecret(encodeAddeparSecret(s))).toEqual(s);
  });
  it("round-trips the config", () => {
    const c = { apiBase: "https://api.addepar.com", addeparFirmId: "999" };
    expect(decodeAddeparConfig(encodeAddeparConfig(c))).toEqual(c);
  });
  it("rejects malformed secret json", () => {
    expect(() => decodeAddeparSecret("{}")).toThrow();
  });
  it("throws on null config", () => {
    expect(() => decodeAddeparConfig(null)).toThrow();
  });
});

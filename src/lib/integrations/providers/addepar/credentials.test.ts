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

  describe("apiBase SSRF guard", () => {
    it.each([
      ["http://api.addepar.com"],
      ["https://169.254.169.254"],
      ["http://localhost/api"],
      ["https://evil.com"],
      ["https://addepar.com.evil.com"],
      ["https://evil-addepar.com"],
    ])("rejects %s", (apiBase) => {
      expect(() => encodeAddeparConfig({ apiBase, addeparFirmId: "999" })).toThrow();
    });

    it.each([
      ["https://api.addepar.com"],
      ["https://firm.addepar.com"],
      ["https://addepar.com"],
    ])("accepts %s", (apiBase) => {
      const c = { apiBase, addeparFirmId: "999" };
      expect(decodeAddeparConfig(encodeAddeparConfig(c))).toEqual(c);
    });
  });
});

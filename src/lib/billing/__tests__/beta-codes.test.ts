import { describe, it, expect } from "vitest";
import { generateCode, normalizeCode, hashCode } from "../beta-codes";

describe("generateCode", () => {
  it("produces the FNDR-XXXX-XXXX shape using the Crockford alphabet", () => {
    const code = generateCode();
    expect(code).toMatch(/^FNDR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("produces distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
    expect(codes.size).toBe(200);
  });
});

describe("normalizeCode", () => {
  it("uppercases, strips dashes/spaces and the FNDR prefix", () => {
    expect(normalizeCode("fndr-7k2p-9qx4")).toBe("7K2P9QX4");
  });

  it("maps ambiguous typed chars O->0 and I/L->1", () => {
    expect(normalizeCode("FNDR-OOLI-0000")).toBe("00110000");
  });
});

describe("hashCode", () => {
  it("is stable and equal for differently-formatted inputs of the same code", () => {
    expect(hashCode("FNDR-7K2P-9QX4")).toBe(hashCode("fndr 7k2p 9qx4"));
  });

  it("differs for different codes", () => {
    expect(hashCode("FNDR-7K2P-9QX4")).not.toBe(hashCode("FNDR-7K2P-9QX5"));
  });
});

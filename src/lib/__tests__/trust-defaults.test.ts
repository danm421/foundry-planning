import { describe, it, expect } from "vitest";
import { defaultIsGrantorFor } from "../trust-defaults";

describe("defaultIsGrantorFor", () => {
  it("defaults IDGT to grantor — a non-grantor IDGT is a contradiction", () => {
    expect(defaultIsGrantorFor("idgt")).toBe(true);
  });

  it("defaults CLT to grantor — the upfront §170(f)(2)(B) regime the spec targets", () => {
    expect(defaultIsGrantorFor("clt")).toBe(true);
  });

  it("leaves CRT non-grantor — §664(c) makes the flag inert for a CRT", () => {
    expect(defaultIsGrantorFor("crt")).toBe(false);
  });

  it("leaves other subtypes non-grantor", () => {
    expect(defaultIsGrantorFor("ilit")).toBe(false);
    expect(defaultIsGrantorFor("irrevocable")).toBe(false);
    expect(defaultIsGrantorFor("")).toBe(false);
  });
});

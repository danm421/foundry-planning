import { describe, expect, it } from "vitest";
import { bindingText, parseBinding } from "../bindings";

describe("bindings", () => {
  it("parses cell, holding and section bindings", () => {
    expect(parseBinding("cell:accountName")).toEqual({ kind: "cell", columnId: "accountName" });
    expect(parseBinding("holding:shares")).toEqual({ kind: "holding", field: "shares" });
    expect(parseBinding("section")).toEqual({ kind: "section" });
  });

  it("rejects unknown bindings", () => {
    expect(parseBinding("holding:bogus")).toBeNull();
    expect(parseBinding("cell:")).toBeNull();
    expect(parseBinding("nope")).toBeNull();
  });

  it("round-trips through bindingText", () => {
    for (const t of ["cell:accountName", "holding:marketValue", "section"]) {
      expect(bindingText(parseBinding(t)!)).toBe(t);
    }
  });
});

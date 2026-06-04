import { describe, it, expect } from "vitest";
import { buildResolveContext, EMPTY_RESOLVE_DATA, type ResolveContextData } from "../resolve";

const data: ResolveContextData = {
  ...EMPTY_RESOLVE_DATA,
  accountsById: { a1: { name: "Roth 401(k)", category: "retirement", subType: "roth_401k" } },
  recipientsById: { "family_member:f1": "Jane Cooper", "external_beneficiary:x1": "Marin Community Foundation" },
  spouseName: "Susan",
};

describe("buildResolveContext", () => {
  const ctx = buildResolveContext(data);
  it("resolves account name + info", () => {
    expect(ctx.accountName("a1")).toBe("Roth 401(k)");
    expect(ctx.accountName("nope")).toBe("an account");
    expect(ctx.accountInfo("a1")?.category).toBe("retirement");
  });
  it("resolves recipients by kind", () => {
    expect(ctx.recipientName("family_member", "f1")).toBe("Jane Cooper");
    expect(ctx.recipientName("external_beneficiary", "x1")).toBe("Marin Community Foundation");
    expect(ctx.recipientName("spouse", null)).toBe("Susan");
    expect(ctx.recipientName("family_member", "missing")).toBe("a recipient");
  });
});

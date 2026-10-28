import { describe, expect, it } from "vitest";
import type { ClientData } from "@/engine/types";
import { accountName, bequestWhen, pct, roleFirstName } from "../trust-labels";

const tree = (spouseName: string | null) =>
  ({ client: { firstName: "Pat", spouseName }, accounts: [{ id: "a", name: " Joint " }, { id: "b", name: " " }] }) as unknown as ClientData;

describe("trust-labels", () => {
  it("falls back to the co-client label, never 'Spouse'", () => {
    expect(roleFirstName("spouse", tree(null))).toBe("Co-client");
    expect(roleFirstName("spouse", tree("Sam"))).toBe("Sam");
    expect(roleFirstName("client", tree(null))).toBe("Pat");
  });
  it("names accounts with a caller fallback", () => {
    expect(accountName("a", tree(null))).toBe("Joint");
    expect(accountName("b", tree(null), "Asset bequest")).toBe("Asset bequest");
  });
  it("formats percents and bequest timing", () => {
    expect(pct(33.333)).toBe("33.33%");
    expect(bequestWhen("client", "if_spouse_survives", tree("Sam"))).toBe("Pat's will, if Sam survives");
  });
  it("says 'either way' for a married household's unconditional clause, and nothing for a single client", () => {
    const married = { ...tree("Sam"), client: { firstName: "Pat", spouseName: "Sam", spouseDob: "1970-01-01" } } as unknown as ClientData;
    expect(bequestWhen("spouse", "always", married)).toBe("Sam's will, either way");
    expect(bequestWhen("client", "always", tree(null))).toBe("Pat's will");
  });
});

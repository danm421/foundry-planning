import { describe, it, expect } from "vitest";
import { accountLabels } from "./accounts";

describe("accountLabels", () => {
  it("uses the first label of the domain", () => {
    const m = accountLabels([
      { id: "a", email: "dan@foundryplanning.com" },
      { id: "b", email: "dan@gmail.com" },
    ]);
    expect(m.get("a")).toBe("foundryplanning");
    expect(m.get("b")).toBe("gmail");
  });
  it("falls back to full addresses when labels collide", () => {
    const m = accountLabels([
      { id: "a", email: "a@gmail.com" },
      { id: "b", email: "b@gmail.com" },
    ]);
    expect(m.get("a")).toBe("a@gmail.com");
    expect(m.get("b")).toBe("b@gmail.com");
  });
  it("treats a tenant domain and the vanity domain as colliding", () => {
    const m = accountLabels([
      { id: "a", email: "DanMueller@foundryplanning.onmicrosoft.com" },
      { id: "b", email: "dan@foundryplanning.com" },
    ]);
    expect(m.get("a")).toBe("DanMueller@foundryplanning.onmicrosoft.com");
    expect(m.get("b")).toBe("dan@foundryplanning.com");
  });
});

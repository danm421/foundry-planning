import { describe, expect, it } from "vitest";
import { providerState, sortIntegrations } from "./catalog";

describe("providerState", () => {
  it("reads a switched-off provider as coming soon, even with a live connection", () => {
    expect(providerState(false, { status: "connected" })).toBe("coming_soon");
  });

  it("maps each stored status", () => {
    expect(providerState(true, { status: "connected" })).toBe("connected");
    expect(providerState(true, { status: "error" })).toBe("attention");
    expect(providerState(true, { status: "disconnected" })).toBe("available");
    expect(providerState(true, null)).toBe("available");
  });
});

describe("sortIntegrations", () => {
  it("puts what is in use first — broken before healthy — then available, then coming soon", () => {
    const rows = [
      { label: "Schwab", state: "coming_soon" as const },
      { label: "Plaid", state: "available" as const },
      { label: "Orion", state: "connected" as const },
      { label: "Addepar", state: "available" as const },
      { label: "Azure OpenAI", state: "attention" as const },
    ];

    expect(sortIntegrations(rows).map((r) => r.label)).toEqual([
      "Azure OpenAI",
      "Orion",
      "Addepar",
      "Plaid",
      "Schwab",
    ]);
  });

  it("does not reorder the caller's array", () => {
    const rows = [
      { label: "B", state: "available" as const },
      { label: "A", state: "available" as const },
    ];
    sortIntegrations(rows);
    expect(rows.map((r) => r.label)).toEqual(["B", "A"]);
  });
});

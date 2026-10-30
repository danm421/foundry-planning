import { describe, expect, it } from "vitest";
import { INTEGRATION_INFO, WORKSPACE_LABEL, providerState, providerStateFromConnections, sortIntegrations } from "./catalog";

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

describe("providerStateFromConnections", () => {
  it("is attention if any connection is broken, else connected if any is live, else available", () => {
    expect(providerStateFromConnections(true, [{ status: "connected" }, { status: "error" }])).toBe("attention");
    expect(providerStateFromConnections(true, [{ status: "disconnected" }, { status: "connected" }])).toBe("connected");
    expect(providerStateFromConnections(true, [{ status: "disconnected" }])).toBe("available");
    expect(providerStateFromConnections(true, [])).toBe("available");
  });

  it("reads a switched-off provider as coming soon, even with a live connection", () => {
    expect(providerStateFromConnections(false, [{ status: "connected" }])).toBe("coming_soon");
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

describe("INTEGRATION_INFO", () => {
  it("files the Calendar & to-dos row under Workspace", () => {
    expect(WORKSPACE_LABEL).toBe("Calendar & to-dos");
    expect(INTEGRATION_INFO.microsoft_365.category).toBe("Workspace");
  });
});

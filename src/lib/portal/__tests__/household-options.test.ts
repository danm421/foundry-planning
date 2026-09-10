import { describe, it, expect, vi, beforeEach } from "vitest";

const { householdNamesMock, firmNamesMock } = vi.hoisted(() => ({
  householdNamesMock: vi.fn(),
  firmNamesMock: vi.fn(),
}));

// Only the two RESOLVERS are replaced. Each module's real exports are spread
// back in so the fallback literals (`UNNAMED_HOUSEHOLD`, `UNNAMED_FIRM`) under
// test are the real ones — a mocked constant would make the fallback
// assertions below tautological and blind to a drift in either module.
vi.mock("@/lib/portal/household-names", async (orig) => ({
  ...(await orig<typeof import("@/lib/portal/household-names")>()),
  resolveHouseholdNames: householdNamesMock,
}));
vi.mock("@/lib/portal/firm-names", async (orig) => ({
  ...(await orig<typeof import("@/lib/portal/firm-names")>()),
  resolvePortalFirmNames: firmNamesMock,
}));

import { loadPortalHouseholdOptions } from "@/lib/portal/household-options";
import type { BindingRef } from "@/lib/portal/bindings";

function binding(over: Partial<BindingRef> = {}): BindingRef {
  return {
    bindingId: "b1",
    clientId: "client-1",
    firmId: "org_a",
    advisorId: "user_adv",
    acceptedAt: new Date("2026-03-04T09:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  householdNamesMock.mockReset();
  firmNamesMock.mockReset();
  householdNamesMock.mockResolvedValue(new Map());
  firmNamesMock.mockResolvedValue(new Map());
});

describe("loadPortalHouseholdOptions", () => {
  it("returns nothing, and looks up no names, below two households", async () => {
    expect(await loadPortalHouseholdOptions([binding()])).toEqual([]);
    expect(await loadPortalHouseholdOptions([])).toEqual([]);
    expect(householdNamesMock).not.toHaveBeenCalled();
    expect(firmNamesMock).not.toHaveBeenCalled();
  });

  it("labels every option '<household> · <firm>'", async () => {
    householdNamesMock.mockResolvedValue(
      new Map([
        ["client-1", "The Reed Household"],
        ["client-2", "The Alvarez Household"],
      ]),
    );
    firmNamesMock.mockResolvedValue(
      new Map([
        ["org_a", "Northgate Advisors"],
        ["org_b", "Latimer Wealth"],
      ]),
    );

    const options = await loadPortalHouseholdOptions([
      binding(),
      binding({ bindingId: "b2", clientId: "client-2", firmId: "org_b" }),
    ]);

    expect(options).toEqual([
      { clientId: "client-1", label: "The Reed Household · Northgate Advisors" },
      { clientId: "client-2", label: "The Alvarez Household · Latimer Wealth" },
    ]);
    expect(householdNamesMock).toHaveBeenCalledWith(["client-1", "client-2"]);
    expect(firmNamesMock).toHaveBeenCalledWith(["org_a", "org_b"]);
  });

  // The reason the firm half is unconditional. One real family held by two
  // firms is TWO `clients` rows that derive the SAME household name — exactly
  // the client this switcher exists for. Household name alone renders two
  // identical options and the picker becomes a coin toss.
  it("keeps two options distinguishable when their household names COLLIDE", async () => {
    householdNamesMock.mockResolvedValue(
      new Map([
        ["client-1", "The Reed Household"],
        ["client-2", "The Reed Household"],
      ]),
    );
    firmNamesMock.mockResolvedValue(
      new Map([
        ["org_a", "Northgate Advisors"],
        ["org_b", "Latimer Wealth"],
      ]),
    );

    const options = await loadPortalHouseholdOptions([
      binding(),
      binding({ bindingId: "b2", clientId: "client-2", firmId: "org_b" }),
    ]);

    expect(options.map((o) => o.label)).toEqual([
      "The Reed Household · Northgate Advisors",
      "The Reed Household · Latimer Wealth",
    ]);
    expect(new Set(options.map((o) => o.label)).size).toBe(2);
  });

  it("falls back to 'Your household' and 'A firm' when a name resolves to nothing", async () => {
    const options = await loadPortalHouseholdOptions([
      binding(),
      binding({ bindingId: "b2", clientId: "client-2", firmId: "org_b" }),
    ]);
    expect(options.map((o) => o.label)).toEqual([
      "Your household · A firm",
      "Your household · A firm",
    ]);
  });
});

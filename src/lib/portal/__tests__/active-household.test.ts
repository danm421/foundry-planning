import { describe, it, expect } from "vitest";
import { pickActiveBinding, ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/portal/active-household";
import type { BindingRef } from "@/lib/portal/bindings";

function ref(clientId: string, acceptedAt: string): BindingRef {
  return {
    bindingId: `b-${clientId}`,
    clientId,
    firmId: "org_1",
    advisorId: "user_a",
    acceptedAt: new Date(acceptedAt),
  };
}

const older = ref("client-old", "2026-01-01T00:00:00Z");
const newer = ref("client-new", "2026-06-01T00:00:00Z");

describe("pickActiveBinding", () => {
  it("returns null when the user holds no bindings", () => {
    expect(pickActiveBinding([], "client-anything")).toBeNull();
  });

  it("honours a cookie that names a binding the user actually holds", () => {
    expect(pickActiveBinding([newer, older], "client-old")?.clientId).toBe("client-old");
  });

  it("IGNORES a cookie naming a household the user does not hold", () => {
    // The security case: the cookie is a selector within the list from the
    // database, never an authority of its own.
    expect(pickActiveBinding([newer, older], "client-someone-else")?.clientId).toBe("client-new");
  });

  it("falls back to the most recently accepted binding with no cookie", () => {
    expect(pickActiveBinding([older, newer], null)?.clientId).toBe("client-new");
  });

  it("tolerates a null acceptedAt without crashing or winning", () => {
    const nullAccepted: BindingRef = { ...ref("client-null", "2026-01-01T00:00:00Z"), acceptedAt: null };
    expect(pickActiveBinding([nullAccepted, newer], null)?.clientId).toBe("client-new");
  });

  it("names the cookie stably", () => {
    expect(ACTIVE_HOUSEHOLD_COOKIE).toBe("foundry_portal_household");
  });

  // --- Additional coverage beyond the brief's six tests ---

  it("still returns a binding, never null, when every acceptedAt is null", () => {
    const a: BindingRef = { ...ref("client-a", "2026-01-01T00:00:00Z"), acceptedAt: null };
    const b: BindingRef = { ...ref("client-b", "2026-01-01T00:00:00Z"), acceptedAt: null };
    // Deterministic tie-break: ascending bindingId. "b-client-a" < "b-client-b".
    expect(pickActiveBinding([a, b], null)?.clientId).toBe("client-a");
    expect(pickActiveBinding([b, a], null)?.clientId).toBe("client-a");
  });

  it("breaks a tied acceptedAt deterministically, independent of array order", () => {
    const a = ref("client-a", "2026-03-01T00:00:00Z");
    const b = ref("client-b", "2026-03-01T00:00:00Z");
    const forward = pickActiveBinding([a, b], null);
    const backward = pickActiveBinding([b, a], null);
    expect(forward?.clientId).toBe(backward?.clientId);
    expect(forward?.clientId).toBe("client-a");
  });

  it("does not select on an empty-string cookie value", () => {
    expect(pickActiveBinding([older, newer], "")?.clientId).toBe("client-new");
  });

  it("does not select a clientId the cookie only prefix-matches", () => {
    // "client-ol" is a prefix of the real clientId "client-old" but not equal to it.
    expect(pickActiveBinding([older, newer], "client-ol")?.clientId).toBe("client-new");
  });

  it("does not select a clientId the cookie only matches case-insensitively", () => {
    expect(pickActiveBinding([older, newer], "CLIENT-OLD")?.clientId).toBe("client-new");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CapabilityKey } from "@/lib/ops/entitlements";

const mockRequireOpsAdmin = vi.fn();
const mockSetEntitlementOverride = vi.fn();
const mockSetUserEntitlementOverride = vi.fn();
const mockRevalidatePath = vi.fn();

// The registry stands in for the real one. What it must MIRROR — that
// client_portal is the only per-user key — is pinned separately against the
// real export by ops/__tests__/entitlements.test.ts, so this double cannot
// quietly widen the gate. Hoisted because vi.mock factories run first.
const { CAPABILITIES } = vi.hoisted(() => ({
  CAPABILITIES: [
    { key: "ai_import", label: "AI document import", description: "d" },
    { key: "client_portal", label: "Client portal", description: "d", perUser: true },
  ] as CapabilityKey[],
}));

vi.mock("@/lib/ops/ops-auth", () => ({ requireOpsAdmin: () => mockRequireOpsAdmin() }));
vi.mock("@/lib/ops/entitlements", () => ({
  CAPABILITY_KEYS: CAPABILITIES,
  setEntitlementOverride: (...a: unknown[]) => mockSetEntitlementOverride(...a),
  setUserEntitlementOverride: (...a: unknown[]) => mockSetUserEntitlementOverride(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

import { toggleUserEntitlementAction } from "../actions";

const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  const base: Record<string, string> = {
    firmId: "org_firm",
    clerkUserId: "u_advisor",
    entitlement: "client_portal",
    mode: "grant",
    reason: "pilot",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOpsAdmin.mockResolvedValue({ clerkUserId: "u_ops", email: "op@foundry", role: "superadmin" });
  mockSetUserEntitlementOverride.mockResolvedValue(undefined);
});

describe("toggleUserEntitlementAction", () => {
  it("writes the override and revalidates the tab", async () => {
    await toggleUserEntitlementAction(form());
    expect(mockSetUserEntitlementOverride).toHaveBeenCalledWith({
      firmId: "org_firm",
      clerkUserId: "u_advisor",
      entitlement: "client_portal",
      mode: "grant",
      reason: "pilot",
      setBy: "u_ops",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/orgs/org_firm/entitlements");
  });

  it("takes the actor from requireOpsAdmin, never from the form", async () => {
    const fd = form();
    fd.set("setBy", "u_impostor");
    await toggleUserEntitlementAction(fd);
    expect(mockSetUserEntitlementOverride.mock.calls[0][0].setBy).toBe("u_ops");
  });

  it("REFUSES a capability that is not flagged per-user", async () => {
    // The read path is key-agnostic: without this gate a per-user row for
    // ai_import would silently take effect and defeat "AI keys stay firm-wide".
    await expect(toggleUserEntitlementAction(form({ entitlement: "ai_import" }))).rejects.toThrow();
    expect(mockSetUserEntitlementOverride).not.toHaveBeenCalled();
  });

  it("takes the FIRST registry entry for a key, so a duplicate cannot open the gate", async () => {
    // `.some(c => c.key === k && c.perUser)` scans until ANY entry satisfies both,
    // so a stray non-perUser duplicate ahead of the real one would still pass.
    // First-wins refuses. Not attacker-reachable — the registry is source code —
    // but the stricter read is free.
    CAPABILITIES.unshift({ key: "client_portal", label: "Client portal", description: "d" });
    try {
      await expect(toggleUserEntitlementAction(form())).rejects.toThrow();
      expect(mockSetUserEntitlementOverride).not.toHaveBeenCalled();
    } finally {
      CAPABILITIES.shift();
    }
  });

  it("REFUSES a capability with no registry entry at all", async () => {
    await expect(toggleUserEntitlementAction(form({ entitlement: "made_up" }))).rejects.toThrow();
    expect(mockSetUserEntitlementOverride).not.toHaveBeenCalled();
  });

  it("requires ops admin BEFORE it validates anything", async () => {
    mockRequireOpsAdmin.mockRejectedValue(new Error("not ops"));
    await expect(toggleUserEntitlementAction(new FormData())).rejects.toThrow("not ops");
    expect(mockSetUserEntitlementOverride).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank firm", { firmId: "" }],
    ["a blank user", { clerkUserId: "" }],
    ["a mode that is neither grant nor revoke", { mode: "sideways" }],
    ["a blank reason", { reason: "   " }],
  ])("refuses %s", async (_label, over) => {
    await expect(toggleUserEntitlementAction(form(over))).rejects.toThrow();
    expect(mockSetUserEntitlementOverride).not.toHaveBeenCalled();
  });
});

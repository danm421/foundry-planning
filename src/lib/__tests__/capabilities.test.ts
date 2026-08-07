import { describe, it, expect, vi } from "vitest";
import { roleHasCapability, STAFF_ROLES } from "../capabilities";

describe("roleHasCapability", () => {
  it("operations gets CRM + tasks but NOT planning", () => {
    expect(roleHasCapability("org:operations", "crm:write")).toBe(true);
    expect(roleHasCapability("org:operations", "tasks:write")).toBe(true);
    expect(roleHasCapability("org:operations", "planning:read")).toBe(false);
  });

  it("planner gets planning + CRM + tasks but not firm/billing", () => {
    expect(roleHasCapability("org:planner", "planning:write")).toBe(true);
    expect(roleHasCapability("org:planner", "crm:write")).toBe(true);
    expect(roleHasCapability("org:planner", "firm:config")).toBe(false);
    expect(roleHasCapability("org:planner", "billing:manage")).toBe(false);
  });

  it("owner gets everything; admin gets all but billing; member is planning/crm/tasks", () => {
    expect(roleHasCapability("org:owner", "billing:manage")).toBe(true);
    expect(roleHasCapability("org:admin", "team:manage")).toBe(true);
    expect(roleHasCapability("org:admin", "billing:manage")).toBe(false);
    expect(roleHasCapability("org:member", "planning:write")).toBe(true);
    expect(roleHasCapability("org:member", "team:manage")).toBe(false);
  });

  // org:advisor is a LIVE custom Clerk role (firms invite their advisors under
  // it). It is firm-wide, not staff, so it carries the member capability set —
  // and must never reach the admin-only capabilities.
  it("advisor gets planning + CRM + tasks but not firm/team/billing", () => {
    expect(roleHasCapability("org:advisor", "planning:write")).toBe(true);
    expect(roleHasCapability("org:advisor", "crm:write")).toBe(true);
    expect(roleHasCapability("org:advisor", "tasks:write")).toBe(true);
    expect(roleHasCapability("org:advisor", "firm:config")).toBe(false);
    expect(roleHasCapability("org:advisor", "team:manage")).toBe(false);
    expect(roleHasCapability("org:advisor", "billing:manage")).toBe(false);
  });

  it("treats advisor as firm-wide, not book-scoped staff", () => {
    expect(STAFF_ROLES.has("org:advisor")).toBe(false);
  });

  it("unknown / null role has no capabilities", () => {
    expect(roleHasCapability(null, "crm:read")).toBe(false);
    expect(roleHasCapability("org:bogus", "crm:read")).toBe(false);
  });

  it("marks operations + planner as staff roles", () => {
    expect(STAFF_ROLES.has("org:operations")).toBe(true);
    expect(STAFF_ROLES.has("org:planner")).toBe(true);
    expect(STAFF_ROLES.has("org:member")).toBe(false);
  });
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { requireCapability } from "../authz";
import { ForbiddenError } from "../authz";
import { UnauthorizedError } from "../db-helpers";

function setAuth(userId: string | null, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgRole } as never);
}

describe("requireCapability", () => {
  it("allows a planner to read planning", async () => {
    setAuth("user_planner", "org:planner");
    await expect(requireCapability("planning:read")).resolves.toBeUndefined();
  });

  it("forbids operations from planning", async () => {
    setAuth("user_ops", "org:operations");
    await expect(requireCapability("planning:read")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws Unauthorized with no session", async () => {
    setAuth(null);
    await expect(requireCapability("crm:read")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

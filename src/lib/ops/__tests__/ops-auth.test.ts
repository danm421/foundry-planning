import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";

const h = vi.hoisted(() => ({
  userId: "user_op" as string | null,
  rows: [] as Array<{ clerkUserId: string; email: string; role: string; disabledAt: Date | null }>,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: () => Promise.resolve({ userId: h.userId }) }));
vi.mock("@/db/schema", () => ({ opsAdmins: { clerkUserId: "clerk_user_id" } }));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(h.rows) }) }) }) },
}));

import { getOpsAdmin, requireOpsAdmin } from "../ops-auth";

beforeEach(() => {
  h.userId = "user_op";
  h.rows = [{ clerkUserId: "user_op", email: "op@foundry", role: "superadmin", disabledAt: null }];
});

describe("getOpsAdmin", () => {
  it("returns the admin for an active row", async () => {
    expect(await getOpsAdmin()).toEqual({ clerkUserId: "user_op", email: "op@foundry", role: "superadmin" });
  });
  it("returns null when no session", async () => {
    h.userId = null;
    expect(await getOpsAdmin()).toBeNull();
  });
  it("returns null when disabled", async () => {
    h.rows = [{ clerkUserId: "user_op", email: "op@foundry", role: "support", disabledAt: new Date() }];
    expect(await getOpsAdmin()).toBeNull();
  });
  it("returns null when not in the table", async () => {
    h.rows = [];
    expect(await getOpsAdmin()).toBeNull();
  });
  it("returns null (fail safe) for an unrecognized role", async () => {
    h.rows = [{ clerkUserId: "user_op", email: "op@foundry", role: "owner", disabledAt: null }];
    expect(await getOpsAdmin()).toBeNull();
  });
});

describe("requireOpsAdmin", () => {
  it("resolves to the admin when authorized", async () => {
    await expect(requireOpsAdmin()).resolves.toEqual(
      expect.objectContaining({ clerkUserId: "user_op", role: "superadmin" }),
    );
  });
  it("throws UnauthorizedError with no session", async () => {
    h.userId = null;
    await expect(requireOpsAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it("throws ForbiddenError when not an ops admin", async () => {
    h.rows = [];
    await expect(requireOpsAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("throws ForbiddenError when role rank is below minRole", async () => {
    h.rows = [{ clerkUserId: "user_op", email: "op@foundry", role: "support", disabledAt: null }];
    await expect(requireOpsAdmin("ops")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("allows a higher role for a lower minRole", async () => {
    h.rows = [{ clerkUserId: "user_op", email: "op@foundry", role: "ops", disabledAt: null }];
    await expect(requireOpsAdmin("support")).resolves.toBeDefined();
  });
  it("throws ForbiddenError (fail safe) for an unrecognized role", async () => {
    h.rows = [{ clerkUserId: "user_op", email: "op@foundry", role: "owner", disabledAt: null }];
    await expect(requireOpsAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

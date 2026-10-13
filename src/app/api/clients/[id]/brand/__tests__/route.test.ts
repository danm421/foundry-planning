import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";

const client = { id: "c1", firmId: "org_a", advisorId: "user_bob", brand: null as string | null };
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ client, firmId: "org_a", access: "own" })),
}));
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn(async () => {}) };
});
const assertBrand = vi.fn();
vi.mock("@/lib/branding/brand-options", () => ({
  assertBrandChoiceAllowed: (...a: unknown[]) => assertBrand(...a),
}));
const setMock = vi.fn();
vi.mock("@/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: async () => setMock(v) }) }) },
}));
const auditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => auditMock(a) }));

import { PUT } from "../route";

const ctx = { params: Promise.resolve({ id: "c1" }) };
const req = (body: unknown) =>
  new Request("http://t/api/clients/c1/brand", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  client.brand = null;
  assertBrand.mockReset().mockResolvedValue(undefined);
  setMock.mockReset();
  auditMock.mockReset();
});

describe("PUT /api/clients/[id]/brand", () => {
  it("saves a picked brand and audits the change", async () => {
    const res = await PUT(req({ brand: "firm" }), ctx);
    expect(res.status).toBe(200);
    expect(assertBrand).toHaveBeenCalledWith("org_a", "firm", "user_bob");
    expect(setMock).toHaveBeenCalledWith({ brand: "firm" });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "client.brand.updated", clientId: "c1", firmId: "org_a", metadata: { from: "user_bob", to: "firm" } }),
    );
  });

  it("picking the household's own advisor stores NULL, so a reassignment carries the brand along", async () => {
    client.brand = "firm";
    const res = await PUT(req({ brand: "user_bob" }), ctx);
    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith({ brand: null });
    expect(assertBrand).toHaveBeenCalledWith("org_a", "user_bob", "firm");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { from: "firm", to: "user_bob" } }),
    );
  });

  it("checks the pick against the household's current brand, not its advisor", async () => {
    client.brand = "firm";
    await PUT(req({ brand: "user_jane" }), ctx);
    expect(assertBrand).toHaveBeenCalledWith("org_a", "user_jane", "firm");
  });

  it("refuses a brand the caller can't use, and writes nothing", async () => {
    assertBrand.mockRejectedValue(new ForbiddenError("That brand isn't available to you for this household."));
    const res = await PUT(req({ brand: "user_other" }), ctx);
    expect(res.status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("rejects a body with no brand id", async () => {
    const res = await PUT(req({ brand: "" }), ctx);
    expect(res.status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });
});

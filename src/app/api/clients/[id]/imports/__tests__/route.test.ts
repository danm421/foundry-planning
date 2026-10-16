import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { db } from "@/db";
import { emptyFactFinderState } from "@/lib/fact-finder/state";

const params = { params: Promise.resolve({ id: "c1" }) };

function makeReq(body: unknown) {
  return new Request("https://app.foundryplanning.com/api/clients/c1/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

let insertedValues: Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  insertedValues = undefined;

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "org_1",
    access: "own",
  });

  const returningMock = vi.fn(async () => [
    { id: "imp-1", ...insertedValues },
  ]);
  const valuesMock = vi.fn((v: Record<string, unknown>) => {
    insertedValues = v;
    return { returning: returningMock };
  });
  vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);
});

describe("POST /api/clients/[id]/imports — surface handling (C1)", () => {
  it.each(["fact_finder", "chat"])(
    "seeds an empty fact finder slice and no chat slice when surface is '%s'",
    async (surface) => {
      const res = await POST(makeReq({ mode: "onboarding", surface }), params);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.import.payloadJson.factFinder).toEqual(emptyFactFinderState());
      expect(json.import.payloadJson).not.toHaveProperty("chat");
    },
  );

  it("leaves payloadJson untouched (relies on the column default) when no surface is sent", async () => {
    const res = await POST(makeReq({ mode: "onboarding" }), params);
    expect(res.status).toBe(201);
    // The brief's own bug: omitting `payloadJson` from the insert entirely
    // for the ordinary wizard path must remain unchanged behavior.
    expect(insertedValues).not.toHaveProperty("payloadJson");
  });

  it("rejects a surface value other than 'fact_finder' or 'chat' rather than silently ignoring it", async () => {
    const res = await POST(
      makeReq({ mode: "onboarding", surface: "bogus" }),
      params,
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("never accepts 'chat' as the mode itself — only 'onboarding'/'updating' are valid (C6)", async () => {
    const res = await POST(makeReq({ mode: "chat" }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid or missing mode");
  });

  it("creates a fact finder import with holdings extraction already on", async () => {
    const res = await POST(makeReq({ mode: "onboarding", surface: "fact_finder" }), params);
    expect(res.status).toBe(201);
    // The INSERTED row, not the response body — the column is what the
    // extract route reads.
    expect(insertedValues).toMatchObject({ extractHoldings: true });
  });

  it("leaves a wizard import's holdings flag at the column default", async () => {
    const res = await POST(makeReq({ mode: "onboarding" }), params);
    expect(res.status).toBe(201);
    expect(insertedValues?.extractHoldings).toBeUndefined();
  });
});

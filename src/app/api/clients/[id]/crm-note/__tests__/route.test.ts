import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/lib/crm/notes", () => ({ createNote: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { requireClientAccess } from "@/lib/clients/authz";
// The @/lib/authz mock spreads importActual, so the REAL ForbiddenError class
// survives the mock — instanceof checks in the route still work.
import { ForbiddenError } from "@/lib/authz";
import { createNote } from "@/lib/crm/notes";
import { POST } from "../route";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const HOUSEHOLD_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://test/api/clients/${CLIENT_ID}/crm-note`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function callPost(body: unknown) {
  return POST(makeRequest(body), { params: Promise.resolve({ id: CLIENT_ID }) });
}

const ownAccess = {
  client: { id: CLIENT_ID, crmHouseholdId: HOUSEHOLD_ID },
  firmId: "org_1",
  permission: "edit",
  access: "own",
};

describe("POST /api/clients/[id]/crm-note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(requireClientAccess).mockResolvedValue(ownAccess as never);
    vi.mocked(createNote).mockResolvedValue({ id: "note-1", title: "Hi" } as never);
  });

  it("401s when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await callPost({ body: "Hi", noteDate: "2026-07-02" });
    expect(res.status).toBe(401);
  });

  it("403s when client access is denied", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(
      new ForbiddenError("Client not found or access denied"),
    );
    const res = await callPost({ body: "Hi", noteDate: "2026-07-02" });
    expect(res.status).toBe(403);
  });

  it("404s for shared-in (cross-firm) clients", async () => {
    vi.mocked(requireClientAccess).mockResolvedValue({
      ...ownAccess,
      access: "shared",
    } as never);
    const res = await callPost({ body: "Hi", noteDate: "2026-07-02" });
    expect(res.status).toBe(404);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("400s on an empty body", async () => {
    const res = await callPost({ body: "   ", noteDate: "2026-07-02" });
    expect(res.status).toBe(400);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("creates a note with a derived subject on the client's household", async () => {
    const res = await callPost({
      body: "## Follow-up\nDiscussed Roth conversions",
      noteDate: "2026-07-02",
    });
    expect(res.status).toBe(201);
    expect(createNote).toHaveBeenCalledWith(HOUSEHOLD_ID, "org_1", "user_1", {
      subject: "Follow-up",
      body: "## Follow-up\nDiscussed Roth conversions",
      noteKind: "note",
      noteDate: "2026-07-02",
    });
  });
});

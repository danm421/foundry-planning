// src/app/api/clients/[id]/imports/[importId]/__tests__/route.test.ts
//
// FIX 3 (whole-branch review): the PATCH handler used to do a wholesale
// `payloadJson` column replace (`updates.payloadJson = payloadJson`).
// ReviewWizard.handleCommit PATCHes `{ payloadJson: { payload: latest } }` on
// every tab commit, so the very first commit erased the `assemble` key (and,
// pre-existing, `fileResults`) from the column — the `Assumed` chip vanished,
// `get_plan_status` reported `questionCount: 0`, and `POST /answers` 400'd.
// These tests pin the shallow-merge fix: `{ ...existingPayloadJson,
// ...payloadJson }`, reusing the `imp` row already loaded for authz.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>(
    "@/lib/imports/authz",
  );
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi
    .fn()
    .mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// Rebindable per-test return for `db.update(...).set(...).where(...).returning()`.
const updateReturningResolve = vi.fn<() => Promise<unknown[]>>();
const updateSetSpy = vi.fn((_values: unknown) => ({
  where: () => ({ returning: () => updateReturningResolve() }),
}));

vi.mock("@/db", () => {
  const update = vi.fn(() => ({ set: updateSetSpy }));
  return { db: { update } };
});

import { PATCH } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireImportAccess } from "@/lib/imports/authz";

function makeReq(body: unknown) {
  return new Request(
    "https://app.foundryplanning.com/api/clients/c1/imports/i1",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as never;
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  updateReturningResolve.mockReset().mockResolvedValue([{ id: "i1" }]);
});

describe("PATCH /api/clients/[id]/imports/[importId] — payloadJson merge (FIX 3)", () => {
  it("a PATCH sending only { payload } leaves a pre-existing `assemble` key intact", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      status: "review",
      createdByUserId: "user_1",
      payloadJson: {
        fileResults: { f1: { warnings: [] } },
        assemble: { version: 1, mergedFileCount: 1, assumptions: [{ field: "x" }], questions: [] },
      },
    } as never);

    const res = await PATCH(
      makeReq({ payloadJson: { payload: { accounts: [{ id: "a1" }] } } }),
      params,
    );

    expect(res.status).toBe(200);
    expect(updateSetSpy).toHaveBeenCalledTimes(1);
    const setArg = updateSetSpy.mock.calls[0][0] as {
      payloadJson: Record<string, unknown>;
    };
    expect(setArg.payloadJson).toEqual({
      fileResults: { f1: { warnings: [] } },
      assemble: { version: 1, mergedFileCount: 1, assumptions: [{ field: "x" }], questions: [] },
      payload: { accounts: [{ id: "a1" }] },
    });
  });

  it("a PATCH sending only { assemble } leaves a pre-existing `payload` (and `fileResults`) intact", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      status: "review",
      createdByUserId: "user_1",
      payloadJson: {
        fileResults: { f1: { warnings: [] } },
        payload: { accounts: [{ id: "a1" }] },
      },
    } as never);

    const newAssemble = {
      version: 1,
      mergedFileCount: 1,
      assumptions: [],
      questions: [{ id: "q1", kind: "identity", field: "client.primaryDob", prompt: "?" }],
    };
    const res = await PATCH(
      makeReq({ payloadJson: { assemble: newAssemble } }),
      params,
    );

    expect(res.status).toBe(200);
    const setArg = updateSetSpy.mock.calls[0][0] as {
      payloadJson: Record<string, unknown>;
    };
    expect(setArg.payloadJson).toEqual({
      fileResults: { f1: { warnings: [] } },
      payload: { accounts: [{ id: "a1" }] },
      assemble: newAssemble,
    });
  });

  it("a PATCH replacing `payload` wholesale still lets the caller replace that key (not append)", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      status: "review",
      createdByUserId: "user_1",
      payloadJson: {
        payload: { accounts: [{ id: "old" }] },
        assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions: [] },
      },
    } as never);

    await PATCH(
      makeReq({ payloadJson: { payload: { accounts: [{ id: "new" }] } } }),
      params,
    );

    const setArg = updateSetSpy.mock.calls[0][0] as {
      payloadJson: Record<string, unknown>;
    };
    // `payload` is replaced wholesale (not merged field-by-field) — only the
    // TOP-LEVEL keys (fileResults/payload/assemble) get the shallow merge.
    expect(setArg.payloadJson.payload).toEqual({ accounts: [{ id: "new" }] });
  });

  it("falls back to {} when the existing column isn't a plain object (defensive)", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      status: "review",
      createdByUserId: "user_1",
      payloadJson: null,
    } as never);

    const res = await PATCH(
      makeReq({ payloadJson: { payload: { accounts: [] } } }),
      params,
    );

    expect(res.status).toBe(200);
    const setArg = updateSetSpy.mock.calls[0][0] as {
      payloadJson: Record<string, unknown>;
    };
    expect(setArg.payloadJson).toEqual({ payload: { accounts: [] } });
  });
});

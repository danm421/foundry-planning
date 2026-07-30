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

// GET reads `db.select().from().where().orderBy()` twice (files, then
// extractions); returning an empty file list short-circuits the second read.
const selectSpy = vi.fn(() => ({
  from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
}));

vi.mock("@/db", () => {
  // Both spies are referenced through a closure, not passed directly: the
  // `vi.mock` factory is hoisted above this file's `const`s, so naming one
  // eagerly is a TDZ error.
  const update = vi.fn(() => ({ set: updateSetSpy }));
  const select = vi.fn((...args: unknown[]) => selectSpy(...(args as [])));
  return { db: { update, select } };
});

import { GET, PATCH } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";

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
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  updateReturningResolve.mockReset().mockResolvedValue([{ id: "i1" }]);
  selectSpy.mockClear();
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

// R8 (whole-branch review, I7). The GET returned the whole import row, and
// `payloadJson.fileResults` now carries each file's raw `text`/`pages` capped at
// 100,000 chars PER FILE. `extraction-progress.tsx` polls this endpoint every
// 1500ms and reads only `status`/`files`.
//
// The review claimed no caller reads `payloadJson` and proposed dropping the
// whole column — that is FALSE: `wizard-import-drawer.tsx`'s `loadImport` reads
// `body.import.payloadJson?.payload` to hydrate the onboarding drawer. So only
// `fileResults` goes. BOTH directions are asserted here, or the next person
// "optimizes" `payload` away too.
describe("GET /api/clients/[id]/imports/[importId] — payloadJson slimming (R8)", () => {
  const FAT_PAYLOAD_JSON = {
    fileResults: {
      f1: { fileName: "big.pdf", warnings: [], text: "x".repeat(100_000) },
    },
    payload: { accounts: [{ id: "a1" }], savings: [{ name: "401k deferral" }] },
    assemble: { version: 1, mergedFileCount: 1, assumptions: [], questions: [] },
  };
  const getParams = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

  async function getBody(payloadJson: unknown) {
    vi.mocked(requireImportAccess).mockResolvedValue({
      id: "i1",
      status: "extracting",
      createdByUserId: "user_1",
      payloadJson,
    } as never);
    const res = await GET({} as never, getParams);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      import: { payloadJson: Record<string, unknown> | null; status: string };
    };
  }

  it("does not ship fileResults", async () => {
    const body = await getBody(FAT_PAYLOAD_JSON);
    expect(body.import.payloadJson).not.toHaveProperty("fileResults");
  });

  it("STILL ships payload — the onboarding drawer hydrates from it", async () => {
    const body = await getBody(FAT_PAYLOAD_JSON);
    expect(body.import.payloadJson?.payload).toEqual({
      accounts: [{ id: "a1" }],
      savings: [{ name: "401k deferral" }],
    });
  });

  // Keep this assertion, but NOT for the reason an earlier revision gave: no
  // consumer of THIS GET reads `assemble`. extraction-progress reads status +
  // files; wizard-import-drawer reads payload + perTabCommittedAt. The Assumed
  // chip and get_plan_status read it from the DB (import-flow-content.tsx:81,
  // plan-builder.ts:54), not from here. It stays because `assemble` is small and
  // narrowing the response further is a separate decision — a false rationale is
  // what invites the next person to delete a line that should stay.
  it("STILL ships assemble — small, and narrowing it is a separate call", async () => {
    const body = await getBody(FAT_PAYLOAD_JSON);
    expect(body.import.payloadJson?.assemble).toEqual({
      version: 1, mergedFileCount: 1, assumptions: [], questions: [],
    });
  });

  it("leaves the rest of the import row alone", async () => {
    const body = await getBody(FAT_PAYLOAD_JSON);
    expect(body.import.status).toBe("extracting");
  });

  it("passes a non-object payloadJson through untouched (defensive)", async () => {
    const body = await getBody(null);
    expect(body.import.payloadJson).toBeNull();
  });

  it("does not mutate the row it was handed", async () => {
    // The handler builds a copy; a `delete` on the live row would corrupt any
    // later read of `imp` in the same request.
    const row = structuredClone(FAT_PAYLOAD_JSON);
    await getBody(row);
    expect(row).toHaveProperty("fileResults");
  });
});

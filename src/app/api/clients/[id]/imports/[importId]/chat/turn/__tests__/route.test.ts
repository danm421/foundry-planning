import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors the mock setup in
// src/app/api/clients/[id]/imports/[importId]/chat/extract/__tests__/gate.test.ts
// and .../chat/finalize/__tests__/route.test.ts — same gate chain (C7).
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
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

// `runTurn` itself is exercised by turn.test.ts — here it's a controllable
// double so this stays a route/gate test with no real Azure call.
const runTurn = vi.fn();
vi.mock("@/lib/statement-chat/turn", () => ({ runTurn: (...a: unknown[]) => runTurn(...a) }));

// --- Stateful @/db mock ---------------------------------------------------
// The route makes exactly two `db.select` round trips (the in-flight-
// extraction check, then the FRESH re-read immediately before writing —
// C12 #1) and one `db.update`. Distinguished structurally: the in-flight
// check chains `.innerJoin(...)`, the fresh read does not.
let inFlightRows: Array<{ id: string }> = [];
let freshRow: { id: string; payloadJson: unknown } = { id: "i1", payloadJson: {} };
let updateCalls: Array<{ values: Record<string, unknown> }> = [];

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: () => Promise.resolve(inFlightRows) }),
        }),
        where: () => ({ limit: () => Promise.resolve([freshRow]) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ values });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import type { ImportPayloadJson } from "@/lib/imports/types";

function importRow(payloadJson: ImportPayloadJson) {
  return { id: "i1", payloadJson, createdByUserId: "user_1" };
}

const CHAT_PAYLOAD: ImportPayloadJson = {
  chat: { surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [] },
  payload: { accounts: [{ __rowId: "r1", name: "IRA", value: 1 }] as never },
  fileResults: {},
};

function req(body: unknown = { message: "hello" }) {
  return new Request("http://t/api/clients/c1/imports/i1/chat/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

function defaultTurnResult() {
  return {
    payload: { accounts: [{ __rowId: "r1", name: "IRA", value: 1 }] },
    turnEntries: [
      { role: "user", text: "hello", at: "2026-01-01T00:00:00.000Z" },
      { role: "assistant", text: "Hi there.", at: "2026-01-01T00:00:00.000Z" },
    ],
    newExcludedRows: [],
    summary: "Hi there.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  inFlightRows = [];
  freshRow = { id: "i1", payloadJson: CHAT_PAYLOAD };
  updateCalls = [];

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(requireImportAccess).mockResolvedValue(importRow(CHAT_PAYLOAD) as never);
  runTurn.mockResolvedValue(defaultTurnResult());
});

describe("chat turn route gates", () => {
  it("401s an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
  });

  it("403s without an active subscription (@/lib/authz's own ForbiddenError)", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("404s a client that cannot be found at all", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("403s a shared (cross-org) recipient with access='shared'", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "edit",
      firmId: "org_owner",
      access: "shared",
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Cross-organization imports are not supported.",
    });
  });

  it("403s a view-only recipient", async () => {
    const { verifyClientAccess } = await import("@/lib/clients/authz");
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "org_1",
      access: "own",
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "View-only access" });
  });

  it("returns the rate-limit response before touching the import", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 5000,
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(429);
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("503s when rate limiting is unconfigured (fails closed)", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "unconfigured",
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(503);
  });

  it("403s ai_import_not_entitled when the entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("404s when the import itself cannot be found for this client/firm", async () => {
    const { NotFoundError } = await import("@/lib/imports/authz");
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new NotFoundError("Import not found"));
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("403s an import owned by a different advisor (@/lib/imports/authz's ForbiddenError)", async () => {
    const { ForbiddenError: ImportForbiddenError } = await import("@/lib/imports/authz");
    vi.mocked(requireImportAccess).mockRejectedValueOnce(
      new ImportForbiddenError("Import not owned by current user"),
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
  });

  it("400s an import with no chat surface", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({ payload: { accounts: [] as never } }) as never,
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This import is not a statement-chat import." });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("400s an empty message", async () => {
    const res = await POST(req({ message: "   " }), params);
    expect(res.status).toBe(400);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("400s a missing message", async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
  });

  it("400s a message over the length cap", async () => {
    const res = await POST(req({ message: "x".repeat(4001) }), params);
    expect(res.status).toBe(400);
    expect(runTurn).not.toHaveBeenCalled();
  });

  // C12 #2: the guard this task adds — no durable "extracting" flag existed
  // on the chat path before this (see the task report), so this uses the
  // per-file `client_import_extractions.status` signal instead.
  it("409s while a file in this import is still being extracted, and never calls runTurn", async () => {
    inFlightRows = [{ id: "ext1" }];
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(runTurn).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

describe("chat turn route behavior", () => {
  it("runs the turn and persists the transcript + excludedRows via writeChatState", async () => {
    runTurn.mockResolvedValue({
      payload: { accounts: [{ __rowId: "r1", name: "IRA", value: 1, basis: 5 }] },
      turnEntries: [
        { role: "user", text: "fix the basis", at: "t1" },
        { role: "tool", tool: "edit_row", summary: "Set basis to 5.", at: "t1" },
        { role: "assistant", text: "Done.", at: "t1" },
      ],
      newExcludedRows: [],
      summary: "Done.",
    });

    const res = await POST(req({ message: "fix the basis" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      payload: { accounts: [{ __rowId: "r1", name: "IRA", value: 1, basis: 5 }] },
      summary: "Done.",
      excludedRows: [],
    });
    expect(body.proposal).toBeUndefined();

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    expect(written.chat?.transcript).toEqual([
      { role: "user", text: "fix the basis", at: "t1" },
      { role: "tool", tool: "edit_row", summary: "Set basis to 5.", at: "t1" },
      { role: "assistant", text: "Done.", at: "t1" },
    ]);
    // `payloadJson.payload` is a sibling of `chat` and is NEVER touched here
    // (C13 — persistence stays owned by the accounts-PATCH path).
    expect(written.payload).toEqual(CHAT_PAYLOAD.payload);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.chat.turn",
        resourceId: "i1",
        metadata: { toolCallCount: 1 },
      }),
    );
  });

  it("includes a proposal in the response when reread_document produced one", async () => {
    runTurn.mockResolvedValue({
      ...defaultTurnResult(),
      proposal: { rowId: "r1", field: "basis", value: 10 },
    });
    const res = await POST(req(), params);
    const body = await res.json();
    expect(body.proposal).toEqual({ rowId: "r1", field: "basis", value: 10 });
  });

  // THE test that matters for C12 #1: the row used to seed the model
  // (`requireImportAccess`'s read) is DELIBERATELY stale here — it has none
  // of the transcript/fileResults the FRESH read carries, simulating a
  // concurrent write (e.g. an extraction) that landed while the turn's model
  // calls were in flight. The persisted result must build on the FRESH row,
  // never the stale one.
  it("re-reads the import row fresh immediately before writing, never the row read for gating", async () => {
    const staleRow: ImportPayloadJson = {
      chat: { surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [] },
      fileResults: {},
    };
    vi.mocked(requireImportAccess).mockResolvedValue(importRow(staleRow) as never);

    freshRow = {
      id: "i1",
      payloadJson: {
        chat: {
          surface: "chat",
          transcript: [{ role: "user", text: "earlier turn", at: "t0" }],
          decisions: [],
          excludedRows: [],
          committedRowIds: [],
        },
        // A concurrent extraction wrote fresh fileResults after the stale
        // read but before this turn's write — writeChatState's sibling-key
        // preservation only holds if `before` is THIS object.
        fileResults: { f1: { fileName: "new.pdf" } as never },
      } satisfies ImportPayloadJson,
    };

    const res = await POST(req({ message: "what does the new file say?" }), params);
    expect(res.status).toBe(200);

    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    // The new turn's entries are APPENDED onto the fresh transcript, not a
    // transcript rebuilt from the stale (empty) one.
    expect(written.chat?.transcript?.[0]).toEqual({ role: "user", text: "earlier turn", at: "t0" });
    expect(written.chat?.transcript?.length).toBe(1 + defaultTurnResult().turnEntries.length);
    // The sibling `fileResults` key survives untouched — proof `before` was
    // the FRESH row, not the stale one (which had an empty fileResults).
    expect(written.fileResults).toEqual({ f1: { fileName: "new.pdf" } });
  });

  it("maps an ai_not_configured error from runTurn to a readable 503", async () => {
    runTurn.mockRejectedValue(new Error("ai_not_configured"));
    const res = await POST(req(), params);
    expect(res.status).toBe(503);
    expect(updateCalls).toHaveLength(0);
  });

  it("500s readably on an unexpected runTurn failure, without leaking the raw error", async () => {
    runTurn.mockRejectedValue(new Error("boom: secret internal detail"));
    const res = await POST(req(), params);
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain("secret internal detail");
    expect(updateCalls).toHaveLength(0);
  });
});

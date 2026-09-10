import { describe, it, expect, vi, beforeEach } from "vitest";

// Important 6: spy on the REAL `gt` (delegating to it, not replacing it) so
// a test can assert the in-flight-extraction guard is actually age-bounded —
// the stateful `@/db` mock below doesn't interpret WHERE clauses, so it
// can't behaviorally prove a `startedAt` cutoff exists on its own.
const gtCalls: Array<[unknown, unknown]> = [];
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    gt: (...args: [unknown, unknown]) => {
      gtCalls.push(args);
      return actual.gt(...(args as Parameters<typeof actual.gt>));
    },
  };
});

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
import { clientImportExtractions } from "@/db/schema";
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
    // No tool mutated anything — this is the plain "no edit" turn.
    payloadMutated: false,
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
  gtCalls.length = 0;

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

  // Important 6 — THE test that matters: `run-extraction.ts` only clears an
  // "extracting" row inside its own try/catch, so a killed process or
  // serverless timeout leaves it stuck forever. Without an age bound, EVERY
  // future turn on this import 409s permanently, telling the advisor to
  // wait for something that will never finish. The stateful `@/db` mock
  // above can't evaluate a real SQL predicate, so this asserts the query
  // was actually built with a `gt(startedAt, <a real past cutoff>)` clause —
  // mutation this catches: dropping that clause (reverting to the
  // reviewed, unbounded guard) leaves `gtCalls` empty.
  it("bounds the in-flight-extraction guard by age, not an unbounded 'ever extracting' check (Important 6)", async () => {
    await POST(req(), params);
    expect(gtCalls).toHaveLength(1);
    const [column, cutoff] = gtCalls[0];
    expect(column).toBe(clientImportExtractions.startedAt);
    expect(cutoff).toBeInstanceOf(Date);
    const ageMs = Date.now() - (cutoff as Date).getTime();
    // Comfortably longer than chat/extract's own 300s (5 min) route cap,
    // but genuinely bounded rather than absent or absurdly long.
    expect(ageMs).toBeGreaterThan(5 * 60 * 1000);
    expect(ageMs).toBeLessThan(20 * 60 * 1000);
  });
});

describe("chat turn route behavior", () => {
  // Final review, C3: the committed-row set is what stops a chat tool from
  // editing or merging a row whose figure is already in the client's plan.
  // It rides in on `chat` — the persisted slice, where `committedRowIds`
  // actually lives — so this pins that the route hands `runTurn` the REAL
  // persisted list, not an empty default or a reconstruction.
  //
  // Mutation this catches: passing `{ surface: "chat", ... }` fresh, or
  // dropping `chat` from the call — `committedRowIds` would come through
  // empty and every mutating tool would go back to accepting a committed row.
  it("hands runTurn the persisted committedRowIds", async () => {
    const withCommitted: ImportPayloadJson = {
      ...CHAT_PAYLOAD,
      chat: { ...CHAT_PAYLOAD.chat!, committedRowIds: ["r1"] },
    };
    vi.mocked(requireImportAccess).mockResolvedValue(importRow(withCommitted) as never);
    freshRow = { id: "i1", payloadJson: withCommitted };

    await POST(req(), params);

    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ committedRowIds: ["r1"] }),
      }),
    );
  });

  it("runs the turn and persists the transcript + excludedRows via writeChatState", async () => {
    runTurn.mockResolvedValue({
      payload: { accounts: [{ __rowId: "r1", name: "IRA", value: 1, basis: 5 }] },
      payloadMutated: true,
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
      turnEntries: [
        { role: "user", text: "fix the basis", at: "t1" },
        { role: "tool", tool: "edit_row", summary: "Set basis to 5.", at: "t1" },
        { role: "assistant", text: "Done.", at: "t1" },
      ],
    });
    expect(body.proposal).toBeUndefined();
    // C1 (Ruling 90) — THE assertion that matters: the response carries the
    // user entry, the assistant entry, and any tool entries VERBATIM (the
    // same array `runTurn` returned), not a route-composed subset or
    // reshape. Mutation this catches: dropping `turnEntries` from the 200
    // response, or returning `nextTranscript` (the full accumulated
    // history, which would ALSO include the pre-existing empty prior
    // transcript) instead of just this turn's own delta.
    expect(body.turnEntries).toEqual([
      { role: "user", text: "fix the basis", at: "t1" },
      { role: "tool", tool: "edit_row", summary: "Set basis to 5.", at: "t1" },
      { role: "assistant", text: "Done.", at: "t1" },
    ]);

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    expect(written.chat?.transcript).toEqual([
      { role: "user", text: "fix the basis", at: "t1" },
      { role: "tool", tool: "edit_row", summary: "Set basis to 5.", at: "t1" },
      { role: "assistant", text: "Done.", at: "t1" },
    ]);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.chat.turn",
        resourceId: "i1",
        metadata: { toolCallCount: 1 },
      }),
    );
  });

  // Task-review correction (Concern 2): a tool-mutated payload must be
  // persisted to `payloadJson.payload` in the SAME write as the transcript —
  // otherwise a turn that edits a row but is never committed leaves a
  // transcript claiming the edit happened while a resumed draft's table
  // still shows the old value. Mutation this catches: dropping the
  // `payload: { accounts: ... }` key from the route's `db.update` call (i.e.
  // reverting to "never persist payload here") — `written.payload` would
  // then equal the ORIGINAL `CHAT_PAYLOAD.payload` (no basis), not the
  // mutated one this test asserts.
  it("persists a tool-mutated payload to payloadJson.payload in the same write as the transcript", async () => {
    runTurn.mockResolvedValue({
      payload: { accounts: [{ __rowId: "r1", name: "IRA", value: 1, basis: 5 }] },
      payloadMutated: true,
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

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    // The mutated payload landed in the SAME write as the transcript...
    expect(written.payload).toEqual({ accounts: [{ __rowId: "r1", name: "IRA", value: 1, basis: 5 }] });
    // ...on the shape this surface actually persists: `accounts` only, never
    // widened to any other section.
    expect(Object.keys(written.payload as object)).toEqual(["accounts"]);
  });

  // The other half of the same correction: a tool that only PROPOSES
  // (reread_document) must never move payload.accounts. `defaultTurnResult`
  // returns the SAME accounts CHAT_PAYLOAD started with, so this proves a
  // proposal-bearing turn persists the payload byte-identical rather than
  // picking up some other change.
  //
  // Final review, I3: it must ALSO carry no `proposal` field. The route used
  // to return one and nothing on the client ever declared it, while the
  // transcript said "awaiting your approval" with nothing to approve. Ruling
  // 93 settled that the advisor approves in words and the model then calls
  // `edit_row` — so the field is gone, and the correction rides in the tool's
  // transcript summary instead.
  it("returns no proposal field, and leaves payloadJson.payload untouched", async () => {
    runTurn.mockResolvedValue({
      ...defaultTurnResult(),
      turnEntries: [
        { role: "user", text: "check the basis", at: "t1" },
        {
          role: "tool",
          tool: "reread_document",
          summary: 'Found a possible correction on "IRA" (row r1): set basis to 10.',
          at: "t1",
        },
        { role: "assistant", text: "Awaiting your approval.", at: "t1" },
      ],
    });
    const res = await POST(req(), params);
    const body = await res.json();
    expect(body).not.toHaveProperty("proposal");
    // The correction is still reachable — it is in the transcript entry the
    // surface actually renders, naming the row, the field and the value.
    expect(body.turnEntries[1].summary).toContain('"IRA"');
    expect(body.turnEntries[1].summary).toContain("set basis to 10");

    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    expect(written.payload).toEqual(CHAT_PAYLOAD.payload);
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

  // Important 7 — the other half of C12 #1 was unproven: the fresh-read test
  // above seeded an EMPTY `excludedRows` on both the stale and fresh rows,
  // so a mutation reducing `nextExcludedRows` to just `turnResult
  // .newExcludedRows` (dropping the `...freshChat.excludedRows` spread)
  // reddened nothing there. This seeds a PRE-EXISTING exclusion (the shape
  // Task 4's rollup detector writes) on the FRESH row and proves the write
  // appends onto it rather than replacing it — the mutation this catches
  // would wipe Task 4's rollup exclusions on the very first chat turn.
  it("appends new excludedRows onto the FRESH excludedRows, never replacing pre-existing ones (Important 7)", async () => {
    const rollupExclusion = {
      row: { __rowId: "rollup-1", name: "Total Accounts" },
      reason: "it is a total covering 2 accounts already listed",
      decision: { kind: "rollup-excluded" as const, label: "Total Accounts", value: 300, coversCount: 2 },
    };
    freshRow = {
      id: "i1",
      payloadJson: {
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [rollupExclusion],
          committedRowIds: [],
        },
        payload: CHAT_PAYLOAD.payload,
        fileResults: {},
      } satisfies ImportPayloadJson,
    };
    runTurn.mockResolvedValue({
      ...defaultTurnResult(),
      newExcludedRows: [{ row: { __rowId: "r2", name: "Dup" }, reason: "duplicate" }],
    });

    const res = await POST(req({ message: "drop the duplicate" }), params);
    expect(res.status).toBe(200);

    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    expect(written.chat?.excludedRows).toHaveLength(2);
    expect(written.chat?.excludedRows?.[0]).toEqual(rollupExclusion);
    expect(written.chat?.excludedRows?.[1]).toMatchObject({ reason: "duplicate" });
  });

  // Important 1 — THE test that matters: a wholesale replace of
  // `payload.accounts` built from the STALE start-of-request snapshot would
  // silently erase a `match`/`linkCreated` stamp a commit wrote (via the
  // separate accounts-PATCH route) WHILE this turn's model calls were still
  // running. r2 here represents exactly that: unmatched at the moment this
  // turn started, matched by the time this route re-reads fresh — and
  // untouched by anything this turn's tools did.
  it("preserves a concurrent commit's match stamp on a row this turn never touched (Important 1)", async () => {
    // ONE shared object reference for r2, reused everywhere it's untouched —
    // exactly how `editRow`/`mergeRows`/`dropRow` in `tools.ts` actually
    // behave (they create a new object only for the row(s) they touch and
    // preserve the exact same reference for every row they don't). A test
    // that instead re-declares an identical-looking-but-distinct r2 literal
    // in `turnResult.payload` would make `mergeAccountsByRowId`'s reference
    // check see r2 as "changed" too, which is not what a real turn produces
    // and would make this test prove nothing.
    const startR2 = { __rowId: "r2", name: "Brokerage", value: 2 };
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        chat: { surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: [] },
        payload: {
          accounts: [{ __rowId: "r1", name: "IRA", value: 1 }, startR2] as never,
        },
        fileResults: {},
      }) as never,
    );
    freshRow = {
      id: "i1",
      payloadJson: {
        chat: { surface: "chat", transcript: [], decisions: [], excludedRows: [], committedRowIds: ["r2"] },
        payload: {
          accounts: [
            { __rowId: "r1", name: "IRA", value: 1 },
            { ...startR2, match: { kind: "exact", existingId: "acct-99" } },
          ] as never,
        },
        fileResults: {},
      } satisfies ImportPayloadJson,
    };
    runTurn.mockResolvedValue({
      payload: {
        accounts: [{ __rowId: "r1", name: "IRA", value: 1, basis: 500 }, startR2],
      },
      payloadMutated: true,
      turnEntries: [
        { role: "user", text: "fix basis", at: "t1" },
        { role: "tool", tool: "edit_row", summary: "Set basis to 500.", at: "t1" },
        { role: "assistant", text: "Done.", at: "t1" },
      ],
      newExcludedRows: [],
      summary: "Done.",
    });

    const res = await POST(req({ message: "fix basis" }), params);
    expect(res.status).toBe(200);

    const written = updateCalls[0].values.payloadJson as ImportPayloadJson;
    const writtenAccounts = written.payload?.accounts as Array<{
      __rowId: string;
      basis?: number;
      match?: unknown;
    }>;
    expect(writtenAccounts.find((r) => r.__rowId === "r1")?.basis).toBe(500);
    // The concurrent commit's stamp on r2 — a row this turn's tools never
    // touched — survives, even though `turnResult.payload` (computed from
    // the stale start-of-request snapshot) has no match on r2 at all.
    expect(writtenAccounts.find((r) => r.__rowId === "r2")?.match).toEqual({
      kind: "exact",
      existingId: "acct-99",
    });
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

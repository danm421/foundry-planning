import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors the mock setup in
// src/app/api/clients/[id]/imports/[importId]/chat/extract/__tests__/gate.test.ts
// — same gate chain (Ruling 70), so the same mock shape.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
// NOT wholesale-mocked: this route maps @/lib/authz's ForbiddenError to 403
// explicitly, so the real class must survive the mock for `instanceof`.
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

// --- @/db mock — only ever reached by markTabsCommitted, on the happy path.
// A stateful `existingRow` models `client_imports.perTabCommittedAt` /
// `committedAt` at the moment markTabsCommitted reads it; `updateCalls`
// records every UPDATE so the premature-finalize test can assert NONE
// happened (status untouched is a "never wrote," not just "wrote the same
// thing back").
let updateCalls: Array<{ values: Record<string, unknown> }> = [];
let existingRow: { perTabCommittedAt: Record<string, string> | null; committedAt: string | null } =
  { perTabCommittedAt: null, committedAt: null };

vi.mock("@/db", () => {
  const select = () => ({ from: () => ({ where: () => Promise.resolve([existingRow]) }) });
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        updateCalls.push({ values });
        return Promise.resolve();
      },
    }),
  });
  return {
    db: {
      select,
      update,
      transaction: (fn: (tx: { select: typeof select; update: typeof update }) => unknown) =>
        Promise.resolve(fn({ select, update })),
    },
  };
});

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { mergeAcrossFiles } from "@/lib/imports/assemble/merge-across-files";
import { detectRollups } from "@/lib/statement-chat/rollups";
import { dropRow, mergeRows } from "@/lib/statement-chat/tools";
import type { ExtractionResult } from "@/lib/extraction/types";
import type { ImportPayloadJson } from "@/lib/imports/types";

function extractionResult(
  accounts: Array<{ name: string; custodian?: string; value?: number }>,
): ExtractionResult {
  return {
    documentType: "other",
    fileName: "statement.pdf",
    extracted: {
      accounts: accounts as never,
      incomes: [],
      expenses: [],
      liabilities: [],
      entities: [],
      lifePolicies: [],
      wills: [],
      savings: [],
      goals: [],
    },
    warnings: [],
    promptVersion: "v",
  } as unknown as ExtractionResult;
}

/** Two plain accounts, no rollup — a clean two-row fixture. */
const CLEAN_FILE_RESULTS: Record<string, ExtractionResult> = {
  f1: extractionResult([
    { name: "IRA", custodian: "Schwab", value: 100 },
    { name: "Brokerage", custodian: "Schwab", value: 200 },
  ]),
};

/** Two real accounts plus a printed total for the same custodian — the
 *  total is `detectRollups`-excluded and must never gate closing. */
const ROLLUP_FILE_RESULTS: Record<string, ExtractionResult> = {
  f1: extractionResult([
    { name: "IRA", custodian: "Schwab", value: 100 },
    { name: "Brokerage", custodian: "Schwab", value: 200 },
    { name: "Total Accounts", custodian: "Schwab", value: 300 },
  ]),
};

/** The real `__rowId`s `mergeAcrossFiles` + `detectRollups` assign for a
 *  fixture — computed the same way the route itself does, rather than
 *  guessed, so a change to the id scheme can't silently desync the fixture
 *  from the assertion. */
function keptRowIds(fileResults: Record<string, ExtractionResult>): string[] {
  const { payload } = mergeAcrossFiles(fileResults);
  const { kept } = detectRollups(payload.accounts);
  return kept.map((r) => r.__rowId as string);
}

/**
 * A realistic `payloadJson.payload.accounts` for a fixture — the kept rows,
 * each already linked (`match: {kind: "exact"}`) as they would be after the
 * per-row commits chat-surface.tsx ran before this finalize call, so
 * `presenceFromPayload` sees real accounts presence (not an empty array)
 * and `requiredCommitTabs` genuinely requires "accounts" — proving the
 * route stamps THAT tab, not just "plan-basics".
 */
function persistedAccounts(fileResults: Record<string, ExtractionResult>) {
  const { payload } = mergeAcrossFiles(fileResults);
  const { kept } = detectRollups(payload.accounts);
  return kept.map((row, i) => ({ ...row, match: { kind: "exact", existingId: `acct-${i}` } }));
}

function importRow(payloadJson: ImportPayloadJson) {
  return { id: "i1", payloadJson };
}

function req() {
  return new Request("http://t/api/clients/c1/imports/i1/chat/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls = [];
  existingRow = { perTabCommittedAt: null, committedAt: null };

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(requireImportAccess).mockResolvedValue(
    importRow({
      fileResults: CLEAN_FILE_RESULTS,
      chat: {
        surface: "chat",
        transcript: [],
        decisions: [],
        excludedRows: [],
        committedRowIds: keptRowIds(CLEAN_FILE_RESULTS),
      },
      payload: { accounts: persistedAccounts(CLEAN_FILE_RESULTS) as never },
    }) as never,
  );
});

describe("chat finalize route gates", () => {
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
    expect(updateCalls).toHaveLength(0);
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
});

describe("chat finalize verification (Ruling 70)", () => {
  it("closes the import once every kept row is committed", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });

    // markTabsCommitted actually ran and persisted — not just a 200 that
    // never touched the database.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.status).toBe("committed");
    expect(updateCalls[0].values.committedAt).toBeInstanceOf(Date);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "import.chat.finalized", resourceId: "i1" }),
    );
  });

  // THE test that matters (brief): if the verification is ever removed or
  // weakened, this must be the one that reddens.
  it("409s a premature finalize with one row uncommitted, and never touches the import", async () => {
    const ids = keptRowIds(CLEAN_FILE_RESULTS);
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [ids[0]], // one of the two kept rows is missing
        },
        payload: { accounts: persistedAccounts(CLEAN_FILE_RESULTS) as never },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("1 account row");

    // Status untouched: no UPDATE, no audit row, for this call.
    expect(updateCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // C1 (final review): a row the advisor retired IN THE CHAT is gone from
  // the working table but comes back out of the route's own recompute (which
  // reads `fileResults`, raw extraction no tool ever edits). Before the fix
  // it was demanded at close forever — a permanent 409 raised by the
  // branch's headline tool.
  //
  // Both fixtures below are produced by the REAL tools (`dropRow` /
  // `mergeRows`), not hand-written: `chat.excludedRows` and
  // `payload.accounts` are exactly what a turn persists, so a change to
  // either shape reddens this instead of quietly passing against a fiction.
  function afterDroppingSecondRow() {
    const { payload } = mergeAcrossFiles(CLEAN_FILE_RESULTS);
    const { kept } = detectRollups(payload.accounts);
    const ids = kept.map((r) => r.__rowId as string);
    const result = dropRow({ accounts: kept }, { rowId: ids[1], reason: "not the client's" });
    return { ids, result };
  }

  it("closes the import after a drop_row retired a row that was never committed", async () => {
    const { ids, result } = afterDroppingSecondRow();
    expect(result.excludedRows?.[0].row.__rowId).toBe(ids[1]);

    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: result.excludedRows ?? [],
          committedRowIds: [ids[0]], // only the surviving row was committed
        },
        payload: result.payload as never,
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });

  // The unrecoverable half: `merge_rows` stamps `irreversible: true`, so
  // "Include anyway" is disabled for the retired row (excluded-rows.tsx) and
  // the advisor has no way to put it back and commit it. If close still
  // demanded it, the import could never be closed by any route at all.
  it("closes the import after an irreversible merge_rows retired a row", async () => {
    const { payload } = mergeAcrossFiles(CLEAN_FILE_RESULTS);
    const { kept } = detectRollups(payload.accounts);
    const ids = kept.map((r) => r.__rowId as string);
    const result = mergeRows({ accounts: kept }, { keepRowId: ids[0], mergeRowId: ids[1] });
    expect(result.excludedRows?.[0]).toMatchObject({ irreversible: true });

    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: result.excludedRows ?? [],
          committedRowIds: [ids[0]],
        },
        payload: result.payload as never,
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });

  // The exclusion must not become a blanket amnesty: a row that is neither
  // committed NOR excluded still blocks the close.
  it("still 409s a row that is neither committed nor excluded in the chat", async () => {
    const { ids, result } = afterDroppingSecondRow();
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: CLEAN_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: result.excludedRows ?? [],
          committedRowIds: [], // the SURVIVING row was never committed
        },
        payload: result.payload as never,
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("1 account row");
    expect(updateCalls).toHaveLength(0);
  });

  it("closes the import even though an excluded rollup row was never committed", async () => {
    const ids = keptRowIds(ROLLUP_FILE_RESULTS);
    expect(ids).toHaveLength(2); // the printed total is excluded, not kept
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        fileResults: ROLLUP_FILE_RESULTS,
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: ids, // both KEPT rows committed; the rollup never is
        },
        payload: { accounts: persistedAccounts(ROLLUP_FILE_RESULTS) as never },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "committed" });
  });
});

describe("chat finalize surface guard (round 1 review, Important 2)", () => {
  // The reviewed hole: a wizard import (tax return, wills, policies — no
  // chat step, no account rows in `fileResults`) sails through the
  // `missing` check with nothing to verify, and without this guard would
  // get "accounts" and "plan-basics" stamped and possibly closed, even
  // though `commitPlanBasics` never ran and `payload.planBasics` was never
  // written anywhere.
  it("400s an import with no chat surface, even when it has nothing to commit", async () => {
    vi.mocked(requireImportAccess).mockResolvedValue(
      importRow({
        // No `chat` key at all — `readChatState` would normalize this to
        // `surface: "chat"` regardless (it fills in a default shape for
        // ANY payload), which is exactly why the guard must be a direct
        // optional-chain read instead.
        fileResults: {},
        payload: { accounts: [] as never, planBasics: {} as never },
      }) as never,
    );

    const res = await POST(req(), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This import is not a statement-chat import." });
    // Never touched: no stamp, no audit row.
    expect(updateCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

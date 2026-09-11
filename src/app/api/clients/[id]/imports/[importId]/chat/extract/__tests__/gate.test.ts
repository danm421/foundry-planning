import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors the mock setup in
// src/app/api/clients/[id]/imports/[importId]/extract/__tests__/gate.test.ts
// (C5 — the brief's mockAuth/mockImportLookup/... helpers don't exist).
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>(
    "@/lib/db-helpers",
  );
  return { ...actual, requireOrgId: vi.fn() };
});
// NOT wholesale-mocked (unlike the wizard's own gate.test.ts): this route
// maps @/lib/authz's ForbiddenError to 403 explicitly, so the real class
// must survive the mock for `instanceof` to work in the "no active
// subscription" test below.
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
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({
  downloadImportFile: vi.fn(async () => Buffer.from("x")),
}));

// --- Stateful @/db mock ---------------------------------------------------
// runImportExtraction makes: (1) a files SELECT, (2) an import-row SELECT
// (+.limit()). This route additionally makes (3) its own fresh import-row
// SELECT after extraction, and writes: per-file clientImportExtractions
// updates (no `payloadJson` key), runImportExtraction's own aggregate
// clientImports write, and this route's own chat-state write (both WITH a
// `payloadJson` key). A shared mutable "row" lets the route's post-extraction
// re-read see what extraction itself just wrote — proving the merge/narrate
// step runs on real, freshly-extracted data rather than a stale pre-read.
let selectCallCount = 0;
let filesResult: unknown[] = [];
/** Count of `db.update(clientImports).set(...)` calls carrying `payloadJson`
 *  — a terminal signal the whole route's async work has settled, since it's
 *  the last thing either runImportExtraction or this route ever writes. */
let payloadJsonUpdateCount = 0;
let currentImportRow: {
  id: string;
  payloadJson: unknown;
  extractHoldings: boolean;
  status: string;
} = { id: "i1", payloadJson: null, extractHoldings: false, status: "draft" };

function fileRow(id: string, name: string) {
  return {
    id,
    blobUrl: `https://blob/${name}`,
    originalFilename: name,
    documentType: "auto",
    detectedKind: "pdf",
    importId: "i1",
    deletedAt: null,
  };
}

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount++;
      const callIndex = selectCallCount;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (callIndex === 1) {
              // First select in the whole request lifecycle: the files list.
              return Promise.resolve(filesResult);
            }
            // Every subsequent select is an import-row read (both
            // runImportExtraction's own, and this route's post-extraction
            // re-read) — always the latest mutable row.
            return { limit: vi.fn(() => Promise.resolve([currentImportRow])) };
          }),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: "ext1" }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(() => {
          // Only a clientImports write ever carries `payloadJson`; the
          // per-file clientImportExtractions updates never do.
          if ("payloadJson" in patch) {
            currentImportRow = { ...currentImportRow, ...patch } as typeof currentImportRow;
            payloadJsonUpdateCount++;
          }
          return Promise.resolve();
        }),
      })),
    })),
  },
}));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { extractDocument } from "@/lib/extraction/extract";
import type { ImportPayloadJson } from "@/lib/imports/types";

function req(signal?: AbortSignal) {
  return new Request("http://t/api/clients/c1/imports/i1/chat/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    ...(signal ? { signal } : {}),
  });
}
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

/** Read every SSE `data: {...}` frame off a Response body into JSON objects. */
async function readSse(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of text.split("\n\n")) {
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (line) events.push(JSON.parse(line.slice("data: ".length)));
  }
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  filesResult = [];
  currentImportRow = { id: "i1", payloadJson: null, extractHoldings: false, status: "draft" };
  payloadJsonUpdateCount = 0;

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  // `mockImplementation`, NOT `mockResolvedValue(currentImportRow)`: the
  // latter captures the object as it stands in THIS beforeEach, and every
  // test below then reassigns `currentImportRow` to a brand-new object — so
  // the gate read would hand the route the empty seed row rather than the
  // fixture the test set up. That went unnoticed while the route only read
  // `extractHoldings` off it (false either way); it reads `payload.accounts`
  // there too since I1.
  vi.mocked(requireImportAccess).mockImplementation(async () => currentImportRow as never);
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
});

describe("chat extract route gates", () => {
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

  // C1: NOT 404 — the brief's own test asserted this wrong. A cross-org
  // (shared) recipient is caught at the client-access gate as a 403.
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

  // C1: the second gate the plan's brief omitted entirely — view-only access.
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

  it("returns the rate-limit response BEFORE opening the stream", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: Date.now() + 5000,
    } as never);
    const res = await POST(req(), params);
    // A gate that fires INSIDE the ReadableStream returns 200 with an error
    // body, which the surface renders as a successful empty import. The
    // status code is the whole point of this assertion.
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).not.toContain("event-stream");
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

  // C1: the other gate the plan's brief omitted entirely.
  it("403s ai_import_not_entitled when the entitlement is absent", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("404s when the import itself cannot be found for this client/firm", async () => {
    const { NotFoundError } = await import("@/lib/imports/authz");
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new NotFoundError("Import not found"));
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("streams once every gate passes", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("keeps going when one statement fails to parse, and narrates only the kept rows", async () => {
    filesResult = [fileRow("f1", "good.pdf"), fileRow("f2", "corrupt.pdf")];
    vi.mocked(extractDocument).mockImplementation(async (_buf, fileName) => {
      if (fileName === "corrupt.pdf") {
        throw new Error("Unsupported PDF encoding");
      }
      return {
        documentType: "other",
        fileName,
        extracted: {
          accounts: [{ name: "IRA", value: 100, statementDate: "2026-03-31" }],
          incomes: [],
          expenses: [],
          liabilities: [],
          entities: [],
          lifePolicies: [],
          wills: [],
          savings: [],
        },
        warnings: [],
        promptVersion: "v",
      } as never;
    });

    const events = await readSse(await POST(req(), params));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "file",
        fileName: "corrupt.pdf",
        error: "Unsupported PDF encoding",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "file", fileName: "good.pdf", accountCount: 1 }),
    );
    // The batch still finishes and still produces a table.
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done" });
    expect((done as { rows: unknown[] }).rows).toHaveLength(1);
    // C10: narrate() must count only the KEPT rows — one account here, not
    // some larger number that would only be true if an excluded row leaked
    // into the count.
    expect((done as { summary: string }).summary).toContain("1 account");
  });

  // C10, isolated: a printed total alongside its two siblings must be
  // dropped from the narrated count, not just from the table. Without this,
  // the summary over-counts by exactly the number the very next caveat says
  // was excluded ("covering 3 accounts" then "already listed" for 2 of them).
  it("narrate() counts only detectRollups().kept, excluding a printed total (C10)", async () => {
    filesResult = [fileRow("f1", "schwab.pdf")];
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "other",
      fileName: "schwab.pdf",
      extracted: {
        accounts: [
          { name: "IRA", custodian: "Schwab", value: 100 },
          { name: "Brokerage", custodian: "Schwab", value: 200 },
          { name: "Total Accounts", custodian: "Schwab", value: 300 },
        ],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    const events = await readSse(await POST(req(), params));
    const done = events.at(-1) as {
      type: string;
      summary: string;
      caveats: string[];
      rows: unknown[];
      excluded: unknown[];
    };

    expect(done.rows).toHaveLength(2);
    expect(done.excluded).toHaveLength(1);
    // The rollup total must not inflate the narrated account count.
    expect(done.summary).toContain("2 accounts");
    expect(done.summary).not.toContain("3 accounts");
    // detectRollups()'s own "rollup-excluded" decision must reach narrate()
    // too, or the caveat explaining WHY a row is missing never renders even
    // though the count is right — narrate.ts's `case "rollup-excluded"`
    // only fires when that decision is in the array it's handed.
    expect(done.caveats.join(" ")).toContain(
      "it is a total covering 2 accounts already listed",
    );

    // IMPORTANT 1 (fix round 1): the SSE payload alone doesn't prove the
    // brief's Step 3 requirement — "persist `decisions` and `excludedRows`
    // via `writeChatState`" — was honored. `currentImportRow` is the shared
    // mutable row the `@/db` mock above writes every `update(...).set(...)`
    // patch into, so it reflects what was actually persisted, independent
    // of what got streamed back to the client.
    const persistedChat = (currentImportRow.payloadJson as ImportPayloadJson).chat;
    expect(persistedChat?.excludedRows).toHaveLength(1);
    expect(persistedChat?.decisions.length).toBeGreaterThan(0);
  });

  // Ruling 89 / Task 11b Step 0 — THE test that matters for this route: the
  // chat turn route (`chat/turn/route.ts:325`) reads rows from
  // `payloadJson.payload.accounts`, and before this fix that key was never
  // written until the advisor's FIRST commit — so the very first question on
  // a freshly-extracted import hit `describeRows` rendering "(no rows)" and
  // every mutating tool threw "unknown row". Mutation this catches: dropping
  // the `payload: { accounts: kept }` key from this route's `db.update` call
  // (reverting to persisting ONLY the chat slice) — `persistedPayload` would
  // then be `undefined` and the `toHaveLength` assertion below would throw.
  it("persists payload.accounts alongside the chat slice, so the chat surface's first question has rows to answer (Step 0)", async () => {
    filesResult = [fileRow("f1", "schwab.pdf")];
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "other",
      fileName: "schwab.pdf",
      extracted: {
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100 }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    await readSse(await POST(req(), params));

    const persistedPayload = (currentImportRow.payloadJson as ImportPayloadJson).payload;
    expect(persistedPayload?.accounts).toHaveLength(1);
    expect(persistedPayload?.accounts?.[0]).toMatchObject({ name: "IRA", value: 100 });
    // Shape stays narrow — only `accounts`, matching what `use-chat-commit.ts`
    // writes at commit time (brief: "Keep the shape narrow").
    expect(Object.keys(persistedPayload as object)).toEqual(["accounts"]);
    // `payload` lands in the SAME write as this route's own chat-state
    // update (Ruling 63 — no THIRD write after that one). Two total updates
    // carry a `payloadJson` key in this flow: `runImportExtraction`'s own
    // aggregate `fileResults` write, then this route's — and it's the
    // SECOND one that must carry `chat` and `payload` together.
    expect(payloadJsonUpdateCount).toBe(2);
    expect(currentImportRow.payloadJson).toHaveProperty("chat");
  });

  // IMPORTANT 2 (fix round 1): the brief names `skipExtracted: true` as one
  // of "three behaviours the route must carry, each with a test" — an
  // already-extracted file must not be re-read (and re-billed) when new
  // files are added to the same import.
  it("does not re-read a file that already has a stored extraction (skipExtracted)", async () => {
    const alreadyExtracted = {
      documentType: "other",
      fileName: "already.pdf",
      extracted: {
        accounts: [{ name: "Old", value: 1 }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    };
    currentImportRow = {
      id: "i1",
      payloadJson: { fileResults: { f1: alreadyExtracted } },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow("f1", "already.pdf"), fileRow("f2", "new.pdf")];
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "other",
      fileName: "new.pdf",
      extracted: {
        accounts: [{ name: "New", value: 2 }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    await readSse(await POST(req(), params));

    expect(extractDocument).toHaveBeenCalledTimes(1);
    expect(vi.mocked(extractDocument).mock.calls[0][1]).toBe("new.pdf");
  });

  // Ruling 97 (Task 11b fix round 1, Important 3) — THE test that matters
  // for this route's "Re-run extraction" button: with NO new files,
  // `runImportExtraction` itself never writes `payloadJson` at all (its own
  // "Nothing new to read" comment). This route's own post-processing used
  // to persist unconditionally regardless, re-deriving `payload.accounts`
  // from the RAW (pre-chat-edit) `fileResults` and silently discarding
  // whatever a chat turn (or a commit's `linkCreated` stamp) had since
  // written. Mutation this catches: removing the
  // `extractionResult.filesProcessed === 0` guard — `done.rows[0].value`
  // would then be the raw 100 from `fileResults`, not the chat-edited 999
  // this test seeds directly on `payload`, and `payloadJsonUpdateCount`
  // would be 1 instead of 0.
  it("does not overwrite payload/chat.decisions/excludedRows on a 'no new files' re-run (Ruling 97)", async () => {
    const alreadyExtracted = {
      documentType: "other",
      fileName: "already.pdf",
      extracted: {
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    };
    const standingChat = {
      surface: "chat" as const,
      transcript: [{ role: "user" as const, text: "fix the value", at: "t0" }],
      decisions: [],
      excludedRows: [{ row: { name: "Dup", __rowId: "r9" }, reason: "duplicate" }],
      committedRowIds: ["r1"],
    };
    const standingPayload = { accounts: [{ name: "IRA", custodian: "Schwab", value: 999, __rowId: "r1" }] };
    currentImportRow = {
      id: "i1",
      payloadJson: {
        fileResults: { f1: alreadyExtracted },
        payload: standingPayload,
        chat: standingChat,
      },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow("f1", "already.pdf")]; // no new files at all

    const events = await readSse(await POST(req(), params));
    expect(extractDocument).not.toHaveBeenCalled();

    const done = events.at(-1) as { rows: Array<{ value: number }> };
    // The STANDING (chat-edited) value survives — never re-derived from
    // the raw fileResults, which carries the pre-edit 100.
    expect(done.rows[0]).toMatchObject({ value: 999 });

    // A pure re-read: no write happened at all.
    expect(payloadJsonUpdateCount).toBe(0);
    expect((currentImportRow.payloadJson as ImportPayloadJson).payload).toEqual(standingPayload);
    expect((currentImportRow.payloadJson as ImportPayloadJson).chat).toEqual(standingChat);
  });

  // Ruling 101 (Task 11b fix round 2) — THE test that matters for the
  // ruling's own defect, not the implementer's reading of Ruling 97:
  // gating the WRITE on "no new files" is correct, but the RESPONSE must
  // still carry the best rows it can derive. An import extracted before
  // Step 0 ever ran has NO `payload` at all (Ruling 89's own premise), so
  // a "no new files" re-run with no standing payload must fall through and
  // re-derive from `fileResults` — both in the response AND in a write
  // that SEEDS `payload` for the first time (nothing to clobber). Mutation
  // this catches: checking only `extractionResult.filesProcessed === 0`
  // (round 1's exact condition, without the `&& standingAccounts` guard) —
  // `done.rows` would then be `[]` and nothing would ever get persisted for
  // this import, since a no-new-files re-run is the only path any advisor
  // can take.
  it("re-derives and seeds payload for a legacy import with no standing payload, even with no new files (Ruling 101)", async () => {
    const alreadyExtracted = {
      documentType: "other",
      fileName: "already.pdf",
      extracted: {
        accounts: [{ name: "IRA", custodian: "Schwab", value: 100 }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    };
    currentImportRow = {
      id: "i1",
      // NO `payload` key at all — every import extracted before Step 0
      // landed looks exactly like this.
      payloadJson: { fileResults: { f1: alreadyExtracted } },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow("f1", "already.pdf")]; // no new files

    const events = await readSse(await POST(req(), params));
    expect(extractDocument).not.toHaveBeenCalled();

    const done = events.at(-1) as { rows: Array<{ name: string; value: number }> };
    // The response is the real re-derived row — not an empty table lying
    // about an import that has plenty.
    expect(done.rows).toHaveLength(1);
    expect(done.rows[0]).toMatchObject({ name: "IRA", value: 100 });

    // The write fires this time — it SEEDS payload, it does not overwrite
    // one that already existed (there was none).
    expect(payloadJsonUpdateCount).toBe(1);
    expect((currentImportRow.payloadJson as ImportPayloadJson).payload?.accounts).toHaveLength(1);
  });

  // Final review, I1 — THE test that matters for "upload another statement".
  // Re-extraction used to persist `payload: { accounts: kept }` outright, so
  // adding one more file threw away every `edit_row` correction, put every
  // `drop_row`/`merge_rows` row back in the table, and dropped every
  // `linkCreated` stamp — while the surface's own copy invites exactly that
  // ("You can still upload another statement first").
  //
  // Mutation this catches: reverting either half — the rebase (the edited
  // 999 and the `exact` stamp would fall back to the raw 100 / `new`), or
  // the chat-exclusion subtraction (the dropped row would reappear).
  it("rebases chat edits, stamps and exclusions onto the fresh merge when a file is added (I1)", async () => {
    const alreadyExtracted = {
      documentType: "other",
      fileName: "already.pdf",
      extracted: {
        accounts: [
          { name: "IRA", custodian: "Schwab", accountNumberLast4: "1234", value: 100 },
          { name: "Dup", custodian: "Fidelity", accountNumberLast4: "9999", value: 50 },
        ],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    };
    // The ids `mergeAcrossFiles` actually mints for those two rows. The
    // last-4 alone: Ruling 120 moved the custodian out of the accounts
    // dedupe key and Task 12 moved the extractor's owner guess out too — and
    // the id is derived from that key, plus (final review #2, C-1) the
    // entry's own `(sourceFileId, indexWithinFile)` coordinate. Both rows are
    // in file `f1`; the IRA is its row 0 and Dup its row 1.
    const IRA_ROW_ID = "account:1234#f1:0";
    const DUP_ROW_ID = "account:9999#f1:1";

    currentImportRow = {
      id: "i1",
      payloadJson: {
        fileResults: { f1: alreadyExtracted },
        // What the advisor has been working on: the IRA corrected to 999 and
        // already committed (`match: exact` is the `linkCreated` stamp), the
        // Dup row dropped in the chat and so absent from the table entirely.
        payload: {
          accounts: [
            {
              name: "IRA",
              custodian: "Schwab",
              accountNumberLast4: "1234",
              value: 999,
              __rowId: IRA_ROW_ID,
              match: { kind: "exact", existingId: "acct-1" },
            },
          ],
        },
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [
            { row: { name: "Dup", __rowId: DUP_ROW_ID }, reason: "not a real account" },
          ],
          committedRowIds: [IRA_ROW_ID],
        },
      },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow("f1", "already.pdf"), fileRow("f2", "new.pdf")];
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "other",
      fileName: "new.pdf",
      extracted: {
        accounts: [{ name: "New", custodian: "Vanguard", accountNumberLast4: "5555", value: 2 }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    const events = await readSse(await POST(req(), params));

    const persisted = (currentImportRow.payloadJson as ImportPayloadJson).payload?.accounts ?? [];
    const byId = new Map(persisted.map((r) => [r.__rowId, r]));

    // 1. The chat edit survived the new upload — and so did the commit stamp.
    expect(byId.get(IRA_ROW_ID)).toMatchObject({
      value: 999,
      match: { kind: "exact", existingId: "acct-1" },
    });
    // 2. The dropped row did NOT come back, even though it is still sitting
    //    in `fileResults` and the fresh merge re-derives it.
    expect(byId.has(DUP_ROW_ID)).toBe(false);
    // 3. The genuinely new account off the new statement IS there.
    expect(persisted.map((r) => r.name)).toEqual(["IRA", "New"]);
    // 4. The exclusion itself is still recorded, so "Not included" still
    //    shows the advisor what they dropped and why.
    expect((currentImportRow.payloadJson as ImportPayloadJson).chat?.excludedRows).toEqual([
      { row: { name: "Dup", __rowId: DUP_ROW_ID }, reason: "not a real account" },
    ]);

    // The streamed rows are what was persisted — not the raw merge, which
    // would leave the screen disagreeing with the database from frame one.
    const done = events.at(-1) as { rows: Array<{ name: string; value: number }> };
    expect(done.rows.map((r) => r.name)).toEqual(["IRA", "New"]);
    expect(done.rows[0].value).toBe(999);
  });

  /**
   * Final review #2, C-1 / Ruling 148 — the SIBLING of the I1 test above,
   * and the one that would have caught the Critical.
   *
   * The I1 test is labelled "THE test that matters for 'upload another
   * statement'", but every row in its fixture has a DISTINCT last-4
   * (1234 / 9999 / 5555). Every bucket is therefore a singleton, the keyed
   * ordinal can never move, and the test passes with the whole ordinal
   * mechanism deleted. It is blind to this failure BY CONSTRUCTION.
   *
   * A SIBLING rather than a fixture change to that test: it pins a different
   * contract (edits, commit stamps and chat exclusions all survive a new
   * upload), and its distinct-last-4 fixture is the honest shape for that
   * one. Widening it would conflate two invariants and let a regression in
   * either hide behind the other. This names the new invariant on its own.
   *
   * THE SHAPE THAT BITES: two accounts at different institutions sharing four
   * masked digits — one bucket, two entries — and the newly uploaded file's
   * id sorting AHEAD of the existing one, which is what the jsonb round-trip
   * hands back roughly half the time.
   *
   * Measured failure before the fix, from this exact fixture: the Schwab
   * account SILENTLY GONE, the Fidelity IRA duplicated, $403,800 on screen
   * against a truth of $289,900, a caveat naming $88,000 against the Fidelity
   * row that no statement ever reported about it, and `finalize` 409ing until
   * the advisor commits the duplicate.
   *
   * Mutation this catches: reverting the coordinate ordinal in
   * `merge-across-files.ts` (back to the entry's rank in its bucket). The
   * Fidelity row's id is recycled onto Schwab, the rebase guard then refuses
   * the stale standing row, and assertions 1, 2 and 3 all go red.
   *
   * It does NOT redden if the rebase guard alone is reverted — MEASURED, not
   * assumed. With the coordinate ordinal in place no id is recycled on this
   * path, so the guard never has to fire here. That is the point of having
   * two independent halves, and it is `rebase.test.ts`'s "refuses to adopt a
   * standing row onto a fresh row from a different source file" that pins the
   * guard on its own.
   */
  it("does not recycle a row id when the added file shares a last-4 bucket (C-1)", async () => {
    // Real-shaped ids: the added one sorts bytewise AHEAD of the existing one.
    const EXISTING_FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const ADDED_FILE = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";
    // Derived from the mint rule: `${label}:${key}#${fileId}:${index}`, on the
    // entry's own minimum coordinate. The Fidelity row is file
    // EXISTING_FILE's row 0.
    const FIDELITY_ROW_ID = `account:7734#${EXISTING_FILE}:0`;

    currentImportRow = {
      id: "i1",
      payloadJson: {
        fileResults: {
          [EXISTING_FILE]: {
            documentType: "account_statement",
            fileName: "fidelity-june.pdf",
            extracted: {
              accounts: [
                { name: "Fidelity Roth IRA", custodian: "Fidelity", accountNumberLast4: "7734", owner: "client", value: 201_900, category: "retirement" },
              ],
              incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [],
            },
            warnings: [],
            promptVersion: "v",
          },
        },
        // What the advisor has been working on, committed. `__provenance` is
        // on it because the merge stamps it and it round-trips through jsonb
        // — the guard's fingerprint is present on BOTH sides in production.
        payload: {
          accounts: [
            {
              name: "Fidelity Roth IRA",
              custodian: "Fidelity",
              accountNumberLast4: "7734",
              owner: "client",
              value: 201_900,
              category: "retirement",
              __rowId: FIDELITY_ROW_ID,
              __provenance: { sourceFileId: EXISTING_FILE, section: "accounts" },
              match: { kind: "exact", existingId: "acct-1" },
            },
          ],
        },
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [FIDELITY_ROW_ID],
        },
      },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow(EXISTING_FILE, "fidelity-june.pdf"), fileRow(ADDED_FILE, "schwab-sept.pdf")];
    // A DIFFERENT real account that happens to share the four masked digits.
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "account_statement",
      fileName: "schwab-sept.pdf",
      extracted: {
        accounts: [
          { name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "7734", owner: "client", value: 88_000, category: "taxable" },
        ],
        incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    const events = await readSse(await POST(req(), params));
    const persisted = (currentImportRow.payloadJson as ImportPayloadJson).payload?.accounts ?? [];

    // 1. TWO rows for TWO real accounts — never one account twice.
    expect([...persisted.map((r) => r.name)].sort()).toEqual([
      "Fidelity Roth IRA",
      "Schwab Brokerage",
    ]);
    // 2. The money on screen is the money on the statements.
    expect(persisted.reduce((sum, r) => sum + (r.value ?? 0), 0)).toBe(289_900);
    // 3. The committed row kept its own id AND its commit stamp, so the
    //    advisor cannot be pushed into committing it a second time.
    const fidelity = persisted.find((r) => r.__rowId === FIDELITY_ROW_ID);
    expect(fidelity).toMatchObject({
      name: "Fidelity Roth IRA",
      value: 201_900,
      match: { kind: "exact", existingId: "acct-1" },
    });
    // 4. The new account has an id of its OWN.
    const schwab = persisted.find((r) => r.name === "Schwab Brokerage");
    expect(schwab?.value).toBe(88_000);
    expect(schwab?.__rowId).toBe(`account:7734#${ADDED_FILE}:0`);

    // 5. No caveat attributes the Schwab figure to the Fidelity row. That
    //    sentence is `rebaseOverrideCaveat`, which only fires when a standing
    //    row's figure beat a fresh one — here nothing was overridden at all.
    const done = events.at(-1) as { rows: Array<{ name: string }>; caveats: string[] };
    expect(done.caveats.some((c) => c.includes("the one that will commit"))).toBe(false);
    expect(done.caveats.join(" ")).not.toContain("$88,000");
    // 6. The stream agrees with the database.
    expect([...done.rows.map((r) => r.name)].sort()).toEqual([
      "Fidelity Roth IRA",
      "Schwab Brokerage",
    ]);
  });

  /**
   * Fix wave 2, Concern 1 — the COMMON case, end to end, and the regression
   * the coordinate ordinal introduced on it.
   *
   * The C-1 sibling above is two DIFFERENT accounts sharing a bucket. This is
   * the ordinary one the surface invites: a NEWER statement for an account
   * already on the import. The two rows merge into ONE entry, so the entry's
   * minimum coordinate — and therefore its `__rowId` — becomes the newly
   * added file's whenever that file's id sorts lower. Roughly half the time.
   *
   * Measured before the fix, on this exact fixture: the standing row found no
   * counterpart, so the rename and the `linkCreated` commit stamp were
   * dropped in silence; the row on screen came back with the FRESH id and
   * `match: { kind: "new" }`; and because that id is not the one in
   * `committedRowIds` its Commit button re-armed. Committing it then INSERTED
   * a SECOND plan account for one real account — measured by driving
   * `commitAccounts` itself, not inferred.
   *
   * Mutation this catches: deleting the re-attachment pass from
   * `rebaseOntoFreshMerge`. Assertions 1, 2 and 3 all go red — the id, the
   * rename and the stamp.
   */
  it("carries a committed row's id, edit and stamp forward when a NEWER statement for the same account is added", async () => {
    const JUNE_FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT_FILE = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84"; // sorts FIRST
    const STANDING_ROW_ID = `account:7734#${JUNE_FILE}:0`;

    currentImportRow = {
      id: "i1",
      payloadJson: {
        fileResults: {
          [JUNE_FILE]: {
            documentType: "account_statement",
            fileName: "fidelity-june.pdf",
            extracted: {
              accounts: [
                { name: "Roth IRA", custodian: "Fidelity", accountNumberLast4: "7734", owner: "client", value: 190_000, category: "retirement", statementDate: "2026-06-30" },
              ],
              incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [],
            },
            warnings: [],
            promptVersion: "v",
          },
        },
        payload: {
          accounts: [
            {
              name: "Julia — Roth (rollover)", // renamed in the chat
              custodian: "Fidelity",
              accountNumberLast4: "7734",
              owner: "client",
              value: 190_000,
              category: "retirement",
              statementDate: "2026-06-30",
              __rowId: STANDING_ROW_ID,
              __provenance: { sourceFileId: JUNE_FILE, section: "accounts" },
              match: { kind: "exact", existingId: "acct-1" },
            },
          ],
        },
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [STANDING_ROW_ID],
        },
      },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow(JUNE_FILE, "fidelity-june.pdf"), fileRow(SEPT_FILE, "fidelity-sept.pdf")];
    // The SAME account, three months later. Same custodian, same last-4.
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "account_statement",
      fileName: "fidelity-sept.pdf",
      extracted: {
        accounts: [
          { name: "Roth IRA", custodian: "Fidelity", accountNumberLast4: "7734", owner: "client", value: 201_900, category: "retirement", statementDate: "2026-09-30" },
        ],
        incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    const events = await readSse(await POST(req(), params));
    const persisted = (currentImportRow.payloadJson as ImportPayloadJson).payload?.accounts ?? [];
    const chat = (currentImportRow.payloadJson as ImportPayloadJson).chat;

    // 0. ONE account, because there is one real account.
    expect(persisted).toHaveLength(1);
    // 1. It still answers to the id the advisor's session recorded, so the
    //    Commit button stays locked (`entity-table.tsx` gates on exactly
    //    this) and `finalize` does not 409 asking for it again.
    expect(persisted[0].__rowId).toBe(STANDING_ROW_ID);
    expect(chat?.committedRowIds).toEqual([STANDING_ROW_ID]);
    expect(chat?.committedRowIds).toContain(persisted[0].__rowId);
    // 2. The rename survived.
    expect(persisted[0].name).toBe("Julia — Roth (rollover)");
    // 3. So did the commit stamp — which is what stops a second commit from
    //    INSERTING a duplicate plan account rather than updating this one.
    expect(persisted[0].match).toEqual({ kind: "exact", existingId: "acct-1" });

    // 4. The newer figure is disclosed rather than silently applied or
    //    silently lost (Ruling 117) — and nothing claims the row vanished.
    const done = events.at(-1) as { rows: Array<{ name: string }>; caveats: string[] };
    expect(done.caveats.some((c) => c.includes("$201,900") && c.includes("Edit the row"))).toBe(true);
    expect(done.caveats.some((c) => c.includes("no longer among the accounts"))).toBe(false);
    // 5. The stream agrees with the database.
    expect(done.rows.map((r) => r.name)).toEqual(["Julia — Roth (rollover)"]);
  });

  /**
   * ── Fix wave 3, I-A: A DROPPED ROW STAYS DROPPED ───────────────────────
   *
   * `drop_row` moves the row into `chat.excludedRows` keyed by the id it had
   * AT THAT MOMENT, and the route subtracts that id from every later merge.
   * But the id is DERIVED: adding a newer statement for the same account
   * moves it, and the stale entry then matched nothing — so the row the
   * advisor explicitly removed came straight back onto the table, while the
   * Excluded list still showed it as excluded. For the `merge_rows` half
   * (`irreversible: true`, "Include anyway" disabled) that is one real
   * account on screen twice, which is the double count this whole branch
   * exists to close.
   *
   * Reproduced end to end against this route before the fix (the dropped
   * "Dad's IRA" came back under `account:5521#<SEPT>:1`).
   *
   * Mutation this catches: not passing the advisor's exclusions through the
   * rebase (`retiredRows`), so their ids are never carried forward.
   */
  it("keeps a dropped row dropped when a NEWER statement for it is added", async () => {
    const JUNE_FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT_FILE = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84"; // sorts FIRST
    const KEPT_ID = `account:7734#${JUNE_FILE}:0`;
    const DROPPED_ID = `account:5521#${JUNE_FILE}:1`;

    const juneAccounts = [
      { name: "Roth IRA", custodian: "Fidelity", accountNumberLast4: "7734", owner: "client", value: 190_000, category: "retirement", statementDate: "2026-06-30" },
      { name: "Dad's IRA", custodian: "Fidelity", accountNumberLast4: "5521", owner: "client", value: 44_000, category: "retirement", statementDate: "2026-06-30" },
    ];
    const standing = (rowId: string, source: (typeof juneAccounts)[number]) => ({
      ...source,
      __rowId: rowId,
      __provenance: { sourceFileId: JUNE_FILE, section: "accounts" },
    });

    currentImportRow = {
      id: "i1",
      payloadJson: {
        fileResults: {
          [JUNE_FILE]: {
            documentType: "account_statement",
            fileName: "fidelity-june.pdf",
            extracted: {
              accounts: juneAccounts,
              incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [],
            },
            warnings: [],
            promptVersion: "v",
          },
        },
        // The advisor dropped "Dad's IRA": gone from the table, recorded in
        // `excludedRows` under the id it had when June was the only file.
        payload: { accounts: [standing(KEPT_ID, juneAccounts[0])] },
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [
            { row: standing(DROPPED_ID, juneAccounts[1]), reason: "not the client's account" },
          ],
          committedRowIds: [],
        },
      },
      extractHoldings: false,
      status: "review",
    } as never;
    filesResult = [fileRow(JUNE_FILE, "fidelity-june.pdf"), fileRow(SEPT_FILE, "fidelity-sept.pdf")];
    // The September statement lists BOTH accounts again — including the one
    // the advisor dropped.
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "account_statement",
      fileName: "fidelity-sept.pdf",
      extracted: {
        accounts: [
          { name: "Roth IRA", custodian: "Fidelity", accountNumberLast4: "7734", owner: "client", value: 201_900, category: "retirement", statementDate: "2026-09-30" },
          { name: "Dad's IRA", custodian: "Fidelity", accountNumberLast4: "5521", owner: "client", value: 45_100, category: "retirement", statementDate: "2026-09-30" },
        ],
        incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    const events = await readSse(await POST(req(), params));
    const persisted = (currentImportRow.payloadJson as ImportPayloadJson).payload?.accounts ?? [];
    const done = events.at(-1) as {
      rows: Array<{ name: string }>;
      excluded: Array<{ row: { __rowId?: string } }>;
    };

    // The dropped account is NOT back — on screen or in the database.
    expect(done.rows.map((r) => r.name)).toEqual(["Roth IRA"]);
    expect(persisted.map((r) => r.name)).toEqual(["Roth IRA"]);
    // ...and it is still recorded as excluded, under the id it was dropped
    // with — identity assigned once, carried forward, never re-minted.
    expect(done.excluded.map((x) => x.row.__rowId)).toEqual([DROPPED_ID]);
    // The row that stayed keeps the advisor's id too (wave 2), so this test
    // cannot pass by the ids simply not having moved.
    expect(persisted[0].__rowId).toBe(KEPT_ID);
  });

  /**
   * Ruling 117, wired end to end. The measured failure was ON SCREEN: a June
   * statement at $100,000 and a September statement at $130,000 for a row the
   * advisor had never touched left $100,000 in the table — correct under I1 —
   * with a caveat directly above it announcing $130,000, because the route
   * narrated the FRESH decisions against the REBASED rows.
   *
   * rebase.test.ts and narrate.test.ts pin each half. Only this pins the
   * ROUTE handing `overrides` to `narrate` at all: without that one argument
   * both halves stay green and the screen still contradicts itself.
   *
   * Mutation this catches: dropping `overrides: rebaseOverrides` from the
   * narrate call (the $130,000 value-conflict caveat comes back and the
   * override caveat vanishes).
   */
  it("names both figures when the rebase holds back a newer statement's balance (Ruling 117)", async () => {
    const juneStatement = {
      documentType: "account_statement",
      fileName: "june.pdf",
      extracted: {
        accounts: [
          {
            name: "Joint Brokerage",
            custodian: "Fidelity",
            accountNumberLast4: "1234",
            owner: "client",
            value: 100_000,
            statementDate: "2026-06-30",
          },
        ],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    };
    // Last-4 alone since Task 12 took the extractor's owner guess out of the
    // accounts dedupe key (Ruling 120 had already taken the custodian out),
    // plus the entry's own coordinate since final review #2's C-1. Both
    // statements collapse into ONE entry whose minimum coordinate is file
    // `f1`'s row 0.
    const ROW_ID = "account:1234#f1:0";

    currentImportRow = {
      id: "i1",
      payloadJson: {
        fileResults: { f1: juneStatement },
        // What the advisor has been looking at since the June upload — the
        // extracted figure, never corrected.
        payload: {
          accounts: [
            {
              name: "Joint Brokerage",
              custodian: "Fidelity",
              accountNumberLast4: "1234",
              owner: "client",
              value: 100_000,
              statementDate: "2026-06-30",
              __rowId: ROW_ID,
            },
          ],
        },
        chat: {
          surface: "chat",
          transcript: [],
          decisions: [],
          excludedRows: [],
          committedRowIds: [],
        },
      },
      extractHoldings: false,
      status: "review",
    };
    filesResult = [fileRow("f1", "june.pdf"), fileRow("f2", "september.pdf")];
    // The September statement for the SAME account, $30,000 higher.
    vi.mocked(extractDocument).mockResolvedValue({
      documentType: "account_statement",
      fileName: "september.pdf",
      extracted: {
        accounts: [
          {
            name: "Joint Brokerage",
            custodian: "Fidelity",
            accountNumberLast4: "1234",
            owner: "client",
            value: 130_000,
            statementDate: "2026-09-30",
          },
        ],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        savings: [],
      },
      warnings: [],
      promptVersion: "v",
    } as never);

    const events = await readSse(await POST(req(), params));
    const done = events.at(-1) as { rows: Array<{ value: number }>; caveats: string[] };

    // The advisor's standing figure is still what shows and what commits.
    expect(done.rows.map((r) => r.value)).toEqual([100_000]);
    // And the caveat names BOTH figures, saying which is on screen.
    expect(done.caveats.join(" ")).toContain("$100,000");
    expect(done.caveats.join(" ")).toContain("$130,000");
    expect(done.caveats.some((c) => c.includes("the one that will commit"))).toBe(true);
    // No caveat may announce $130,000 as the figure that was RECORDED — that
    // is the sentence that used to sit directly above a row reading $100,000.
    expect(done.caveats.some((c) => c.includes("is recorded at $130,000"))).toBe(false);
  });

  // IMPORTANT 4 (fix round 1): proves the ROUTE actually threads its own
  // request's abort signal into runImportExtraction — run-extraction.test.ts
  // proves the check itself works, but nothing short of this proves the
  // one-line `signal: request.signal` wiring survives. Six files / two
  // CONCURRENCY (5) chunks; every call aborts the request's real signal, so
  // the second chunk must never start.
  it("threads request.signal into runImportExtraction (C6 third clause)", async () => {
    filesResult = [
      fileRow("f1", "a.pdf"),
      fileRow("f2", "b.pdf"),
      fileRow("f3", "c.pdf"),
      fileRow("f4", "d.pdf"),
      fileRow("f5", "e.pdf"),
      fileRow("f6", "f.pdf"),
    ];
    const ac = new AbortController();
    vi.mocked(extractDocument).mockImplementation(async (_buf, fileName) => {
      ac.abort();
      return {
        documentType: "other",
        fileName,
        extracted: {
          accounts: [{ name: "x" }],
          incomes: [],
          expenses: [],
          liabilities: [],
          entities: [],
          lifePolicies: [],
          wills: [],
          savings: [],
        },
        warnings: [],
        promptVersion: "v",
      } as never;
    });

    // NOT `readSse`: aborting `ac.signal` also fires the route's own
    // cancel-on-disconnect listener, which closes the SSE stream almost
    // immediately — long before the background extraction work (still
    // running; the ruling forbids cancelling it) actually finishes. Waiting
    // on the STREAM closing would race the assertion below. Waiting for the
    // route's OWN two `payloadJson` writes (runImportExtraction's aggregate
    // write, then this route's chat-state write) to both land is a real
    // terminal signal that every file settle has already happened.
    await POST(req(ac.signal), params);
    await vi.waitFor(() => {
      expect(payloadJsonUpdateCount).toBe(2);
    });

    // Only the first chunk ran — the 6th file's chunk never started.
    expect(extractDocument).toHaveBeenCalledTimes(5);
  });
});

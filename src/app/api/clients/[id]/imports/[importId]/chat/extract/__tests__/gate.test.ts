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

function req() {
  return new Request("http://t/api/clients/c1/imports/i1/chat/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
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

  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(requireImportAccess).mockResolvedValue(currentImportRow as never);
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
    const done = events.at(-1) as { type: string; summary: string; rows: unknown[]; excluded: unknown[] };

    expect(done.rows).toHaveLength(2);
    expect(done.excluded).toHaveLength(1);
    // The rollup total must not inflate the narrated account count.
    expect(done.summary).toContain("2 accounts");
    expect(done.summary).not.toContain("3 accounts");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));

import { POST } from "./route";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { extractDocument } from "@/lib/extraction/extract";

const ctx = { params: Promise.resolve({ id: "client-1" }) };

/** A minimal but genuine PDF header so detectUploadKind accepts the upload. */
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function req(file?: File): Request {
  const body = new FormData();
  if (file) body.set("file", file);
  return new Request("http://t/extract-holdings", { method: "POST", body });
}

const pdf = (bytes: Uint8Array = PDF_BYTES) =>
  new File([bytes as BlobPart], "statement.pdf", { type: "application/pdf" });

function extractionResult(accounts: unknown[], warnings: string[] = []) {
  return {
    documentType: "account_statement",
    fileName: "statement.pdf",
    extracted: {
      accounts,
      incomes: [],
      expenses: [],
      liabilities: [],
      entities: [],
      lifePolicies: [],
      wills: [],
      savings: [],
      goals: [],
    },
    warnings,
    promptVersion: "test",
  } as unknown as Awaited<ReturnType<typeof extractDocument>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("firm-1");
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm-1",
    access: "own",
  });
  vi.mocked(checkImportRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
});

describe("POST rebalance/extract-holdings", () => {
  it("404s when the client is not in the firm", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    const res = await POST(req(pdf()), ctx);

    expect(res.status).toBe(404);
    expect(vi.mocked(extractDocument)).not.toHaveBeenCalled();
  });

  it("403s a view-only advisor", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true,
      permission: "view",
      firmId: "firm-1",
      access: "own",
    });
    const res = await POST(req(pdf()), ctx);

    expect(res.status).toBe(403);
    expect(vi.mocked(extractDocument)).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the rate limiter is unconfigured", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: false, reason: "unconfigured" });
    const res = await POST(req(pdf()), ctx);

    expect(res.status).toBe(503);
    expect(vi.mocked(extractDocument)).not.toHaveBeenCalled();
  });

  it("429s and sets Retry-After when the firm is over its extraction budget", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValue({
      allowed: false,
      reason: "exceeded",
      reset: Date.now() + 30_000,
    });
    const res = await POST(req(pdf()), ctx);

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("400s when no file is attached", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
  });

  it("400s a file whose bytes are not a supported document, whatever it is named", async () => {
    const bogus = new File([new Uint8Array([0, 1, 2, 3, 4, 5]) as BlobPart], "statement.pdf", {
      type: "application/pdf",
    });
    const res = await POST(req(bogus), ctx);

    expect(res.status).toBe(400);
    expect(vi.mocked(extractDocument)).not.toHaveBeenCalled();
  });

  it("returns each statement account with its holdings and a taxable flag", async () => {
    vi.mocked(extractDocument).mockResolvedValue(
      extractionResult([
        {
          name: "Joint Brokerage",
          category: "taxable",
          holdings: [{ ticker: "SPY", shares: 100, price: 50 }],
        },
        {
          name: "Rollover IRA",
          category: "retirement",
          holdings: [{ ticker: "AGG", marketValue: 20000 }],
        },
      ]),
    );

    const res = await POST(req(pdf()), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accounts).toEqual([
      {
        name: "Joint Brokerage",
        taxable: true,
        // shares × price is filled in on the way out so the editor shows a value
        holdings: [{ ticker: "SPY", shares: 100, price: 50, marketValue: 5000 }],
      },
      {
        name: "Rollover IRA",
        taxable: false,
        holdings: [{ ticker: "AGG", marketValue: 20000 }],
      },
    ]);
  });

  it("asks the extractor for holdings, which it does not do by default", async () => {
    vi.mocked(extractDocument).mockResolvedValue(extractionResult([]));
    await POST(req(pdf()), ctx);

    expect(vi.mocked(extractDocument).mock.calls[0][5]).toBe(true);
  });

  it("drops accounts that carry no positions and says so", async () => {
    vi.mocked(extractDocument).mockResolvedValue(
      extractionResult([{ name: "Checking", category: "cash", holdings: [] }]),
    );

    const body = await (await POST(req(pdf()), ctx)).json();

    expect(body.accounts).toEqual([]);
    expect(body.warnings).toContain("No holdings could be read off this document.");
  });

  it("500s without leaking the extractor's error text when extraction throws", async () => {
    vi.mocked(extractDocument).mockRejectedValue(new Error("azure deployment xyz refused"));
    const res = await POST(req(pdf()), ctx);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("azure");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("../gate", () => ({ holdingsImportGate: vi.fn(), refuseOverImportLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/ai/resolve", () => ({
  requireAiAvailableForFirm: vi.fn(),
  withAiForFirm: (_firm: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/extraction/extract", () => ({ extractDocument: vi.fn() }));
vi.mock("@/lib/uploads/staged-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uploads/staged-upload")>()),
  takeStagedUpload: vi.fn(),
  issueStagedUpload: vi.fn(),
}));
vi.mock("@/lib/investments/import-account-holdings", () => ({ importAccountHoldings: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { holdingsImportGate, refuseOverImportLimit } from "../gate";
import { recordAudit } from "@/lib/audit";
import { extractDocument } from "@/lib/extraction/extract";
import { StagedUploadError, takeStagedUpload, issueStagedUpload } from "@/lib/uploads/staged-upload";
import { importAccountHoldings } from "@/lib/investments/import-account-holdings";
import { POST as commit } from "../route";
import { POST as readSpreadsheet } from "../spreadsheet/route";
import { POST as readStatement } from "../statement/route";
import { POST as uploadToken } from "../statement/upload-token/route";

const ctx = { params: Promise.resolve({ id: "client-1", accountId: "acct-1" }) };
const URL_BASE = "http://t/api/clients/client-1/accounts/acct-1/holdings/import";
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const json = (path: string, body: unknown) =>
  new NextRequest(`${URL_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function upload(content: string, name = "holdings.csv") {
  const body = new FormData();
  body.set("file", new File([content], name, { type: "text/csv" }));
  return new NextRequest(`${URL_BASE}/spreadsheet`, { method: "POST", body });
}

function target(last4: string | null = "1234") {
  return { callerOrg: "firm-1", firmId: "firm-1", access: "own" as const, account: { id: "acct-1", last4 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(holdingsImportGate).mockResolvedValue(target());
  vi.mocked(refuseOverImportLimit).mockResolvedValue(null);
  vi.mocked(auth).mockResolvedValue({
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(takeStagedUpload).mockResolvedValue(PDF_BYTES as Buffer<ArrayBuffer>);
});

describe("POST holdings/import (save)", () => {
  const body = {
    source: "spreadsheet",
    mode: "replace",
    holdings: [{ ticker: "VTI", shares: 10 }, { name: "Cash", marketValue: 500 }],
  };

  it("writes the reviewed positions and audits the import", async () => {
    const res = await commit(json("", body), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 2 });
    expect(importAccountHoldings).toHaveBeenCalledWith("acct-1", body.holdings, "replace");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.holdings.import",
        resourceId: "acct-1",
        metadata: { source: "spreadsheet", mode: "replace", count: 2 },
      }),
    );
  });

  it("404s an account that isn't this client's", async () => {
    vi.mocked(holdingsImportGate).mockResolvedValue(null);
    const res = await commit(json("", body), ctx);
    expect(res.status).toBe(404);
    expect(importAccountHoldings).not.toHaveBeenCalled();
  });

  it("refuses a position with neither a ticker nor a name", async () => {
    const res = await commit(json("", { ...body, holdings: [{ shares: 1 }] }), ctx);
    expect(res.status).toBe(400);
    expect(importAccountHoldings).not.toHaveBeenCalled();
  });

  it("hands back the rate limiter's refusal", async () => {
    vi.mocked(refuseOverImportLimit).mockResolvedValue(NextResponse.json({ error: "slow down" }, { status: 429 }));
    const res = await commit(json("", body), ctx);
    expect(res.status).toBe(429);
    expect(importAccountHoldings).not.toHaveBeenCalled();
  });
});

describe("POST holdings/import/spreadsheet", () => {
  it("reads a CSV by its headers and writes nothing", async () => {
    const res = await readSpreadsheet(upload("Symbol,Quantity,Market Value\nVTI,10,3000\n,,\n"), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ holdings: [{ ticker: "VTI", shares: 10, marketValue: 3000 }], warnings: [] });
    expect(importAccountHoldings).not.toHaveBeenCalled();
  });

  it("400s a sheet with no recognizable headers", async () => {
    const res = await readSpreadsheet(upload("foo,bar\n1,2\n"), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/column headers/);
  });

  it("404s an account that isn't this client's", async () => {
    vi.mocked(holdingsImportGate).mockResolvedValue(null);
    const res = await readSpreadsheet(upload("Ticker,Shares\nVTI,1\n"), ctx);
    expect(res.status).toBe(404);
  });
});

describe("POST holdings/import/statement", () => {
  const body = { stagedPathname: "staging/holdings-statement/client-1/x", filename: "statement.pdf" };

  function extracted(accounts: unknown[]) {
    vi.mocked(extractDocument).mockResolvedValue({
      extracted: { accounts },
      warnings: [],
    } as unknown as Awaited<ReturnType<typeof extractDocument>>);
  }

  it("returns each account with positions, and points at the one whose last 4 match", async () => {
    extracted([
      { name: "Joint", accountNumberLast4: "9999", holdings: [{ ticker: "AAPL", shares: 1 }] },
      { name: "IRA", accountNumberLast4: "1234", holdings: [{ ticker: "vti", shares: 2, unrealizedGain: 5 }] },
      { name: "Checking", accountNumberLast4: "5555", holdings: [] },
    ]);
    const res = await readStatement(json("/statement", body), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accounts: [
        { name: "Joint", last4: "9999", holdings: [{ ticker: "AAPL", shares: 1 }] },
        { name: "IRA", last4: "1234", holdings: [{ ticker: "VTI", shares: 2 }] },
      ],
      matchIndex: 1,
      warnings: [],
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.holdings.statement_read", resourceId: "acct-1" }),
    );
  });

  it("points at no account when this one has no last 4 on file", async () => {
    vi.mocked(holdingsImportGate).mockResolvedValue(target(null));
    extracted([{ name: "IRA", accountNumberLast4: "1234", holdings: [{ ticker: "VTI", shares: 2 }] }]);
    const res = await readStatement(json("/statement", body), ctx);
    expect((await res.json()).matchIndex).toBeNull();
  });

  it("403s without the AI import entitlement, and never runs the AI read", async () => {
    vi.mocked(auth).mockResolvedValue({ sessionClaims: {} } as never);
    const res = await readStatement(json("/statement", body), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai_import_not_entitled" });
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("answers a bad staged pathname with its own status", async () => {
    vi.mocked(takeStagedUpload).mockRejectedValue(new StagedUploadError(404, "Upload not found. Please try again."));
    const res = await readStatement(json("/statement", body), ctx);
    expect(res.status).toBe(404);
    expect(extractDocument).not.toHaveBeenCalled();
  });
});

describe("POST holdings/import/statement/upload-token", () => {
  it("issues a token under this client's statement staging prefix", async () => {
    vi.mocked(issueStagedUpload).mockResolvedValue({ pathname: "p", clientToken: "t" });
    const res = await uploadToken(json("/statement/upload-token", { filename: "statement.pdf" }), ctx);

    expect(res.status).toBe(200);
    expect(issueStagedUpload).toHaveBeenCalledWith("staging/holdings-statement/client-1/", "statement.pdf");
  });

  it("403s without the AI import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({ sessionClaims: {} } as never);
    const res = await uploadToken(json("/statement/upload-token", { filename: "statement.pdf" }), ctx);
    expect(res.status).toBe(403);
    expect(issueStagedUpload).not.toHaveBeenCalled();
  });
});

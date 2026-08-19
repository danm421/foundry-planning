// End-to-end proof that a switched-off section's endpoints answer 403 — real
// `requirePortalFeature`, real `authErrorResponse`, real route handlers, with
// only the caller identity and the DB stubbed. One route per switch, including
// Documents, whose gate sits in the vault context rather than the handler.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () =>
    Promise.resolve({ clientId: "c1", mode: "client", clerkUserId: "u1" }),
}));

let features = {
  portalInvestmentsEnabled: true,
  portalBudgetEnabled: true,
  portalDocumentsEnabled: true,
};

vi.mock("@/db/schema", () => ({
  clients: { _name: "clients" },
  crmDocumentFolders: { _name: "crmDocumentFolders" },
  portalPrivacySettings: { _name: "portalPrivacySettings" },
  // Never queried here: the real @/lib/authz pulls in user-overrides.ts, which
  // reads this table's columns at module load. The export only has to exist.
  opsUserEntitlementOverrides: {},
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));
vi.mock("@/db", () => ({
  db: {
    query: { crmDocumentFolders: { findMany: () => Promise.resolve([]) } },
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = () => chain;
      // One row serves every select here: the feature switches for the gate,
      // plus the household/firm the vault context resolves after it.
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve([{ ...features, householdId: "h1", firmId: "f1" }]);
      return chain;
    },
  },
}));

vi.mock("@/lib/crm/folders", () => ({
  ensureSharedFolder: () => Promise.resolve("root-folder"),
}));
vi.mock("@/lib/portal/load-portal-investments", () => ({
  loadPortalInvestments: () => Promise.resolve({ totalValue: 1 }),
}));
vi.mock("@/lib/portal/load-budget-data", () => ({
  loadBudgetSummary: () => Promise.resolve({ month: "2026-08" }),
}));
vi.mock("@/lib/portal/vault-documents", async () => {
  // The real list function so the request still runs through
  // resolvePortalVaultContext — the whole point of the Documents case.
  const { resolvePortalVaultContext } = await import("@/lib/portal/vault-context");
  return {
    listPortalDocuments: async () => {
      await resolvePortalVaultContext();
      return [];
    },
    uploadPortalDocument: () => Promise.resolve({}),
  };
});

import { GET as investmentsGET } from "@/app/api/portal/investments/route";
import { GET as budgetsGET } from "@/app/api/portal/budgets/route";
import { GET as documentsGET } from "@/app/api/portal/documents/route";
import { NextRequest } from "next/server";

const docsReq = (): NextRequest =>
  new NextRequest("http://localhost/api/portal/documents");

beforeEach(() => {
  features = {
    portalInvestmentsEnabled: true,
    portalBudgetEnabled: true,
    portalDocumentsEnabled: true,
  };
});

describe("a switched-off section's API", () => {
  it("403s GET /api/portal/investments", async () => {
    features.portalInvestmentsEnabled = false;
    const res = await investmentsGET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/advisor/i);
  });

  it("403s GET /api/portal/budgets", async () => {
    features.portalBudgetEnabled = false;
    const res = await budgetsGET();
    expect(res.status).toBe(403);
  });

  it("403s GET /api/portal/documents through the vault context", async () => {
    features.portalDocumentsEnabled = false;
    const res = await documentsGET(docsReq());
    expect(res.status).toBe(403);
  });

  // The switches are independent: turning one off must not close the others.
  it("leaves the other sections answering", async () => {
    features.portalBudgetEnabled = false;
    expect((await investmentsGET()).status).toBe(200);
    expect((await documentsGET(docsReq())).status).toBe(200);
  });
});

describe("a switched-on section's API", () => {
  it("answers normally", async () => {
    expect((await investmentsGET()).status).toBe(200);
    expect((await budgetsGET()).status).toBe(200);
    expect((await documentsGET(docsReq())).status).toBe(200);
  });
});

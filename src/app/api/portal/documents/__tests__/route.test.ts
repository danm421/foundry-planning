import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholds, crmDocumentFolders, crmHouseholdDocuments } from "@/db/schema";

/**
 * Integration test for the portal document routes. Deliberately exercises
 * the REAL `resolvePortalVaultContext` + `vault-documents.ts` code paths
 * against the live dev Neon branch — this is the acceptance test for the
 * subtree-containment security boundary (Task 3's unit tests never ran it
 * through a real route). Only the auth-boundary functions and the blob
 * store are mocked:
 * - `resolvePortalClient`  → resolves to a seeded client (no Clerk session)
 * - the subscription/edit gates → always pass
 * - `@vercel/blob`         → no real network calls
 *
 * `vault-context.ts` and `vault-documents.ts` are NOT mocked.
 */

const {
  mockResolvePortalClient,
  mockRequirePortalActiveSubscription,
  mockRequireEditEnabled,
  mockPut,
  mockDel,
  mockGet,
} = vi.hoisted(() => ({
  mockResolvePortalClient: vi.fn(),
  mockRequirePortalActiveSubscription: vi.fn(),
  mockRequireEditEnabled: vi.fn(),
  mockPut: vi.fn(),
  mockDel: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...args: unknown[]) => mockResolvePortalClient(...args),
}));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: (...args: unknown[]) => mockRequirePortalActiveSubscription(...args),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (...args: unknown[]) => mockRequireEditEnabled(...args),
}));
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
  get: (...args: unknown[]) => mockGet(...args),
}));

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const FIRM_ID = "org_portal_doc_routes_test";
const ctx = (docId: string) => ({ params: Promise.resolve({ docId }) });

let clientId: string;
let rootId: string;
let siblingId: string;
let rootDocId: string;
let siblingDocId: string;

async function cleanup() {
  // `clients.crm_household_id` is FK-restrict against crm_households, so
  // clients must go first; households cascade-delete their folders/docs.
  await db.delete(clients).where(eq(clients.firmId, FIRM_ID));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM_ID));
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockRequirePortalActiveSubscription.mockResolvedValue(undefined);
  mockRequireEditEnabled.mockResolvedValue(undefined);
  mockDel.mockResolvedValue(undefined);

  await cleanup();

  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM_ID, advisorId: "advisor_portal_doc_routes", name: "Portal Doc Routes Test HH" })
    .returning();

  const [client] = await db
    .insert(clients)
    .values({
      firmId: FIRM_ID,
      advisorId: "advisor_portal_doc_routes",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 90,
    })
    .returning();
  clientId = client.id;

  const [root] = await db
    .insert(crmDocumentFolders)
    .values({ householdId: household.id, firmId: FIRM_ID, name: "Shared with Client", isSystem: true, isPortalRoot: true })
    .returning({ id: crmDocumentFolders.id });
  rootId = root.id;

  const [sibling] = await db
    .insert(crmDocumentFolders)
    .values({ householdId: household.id, firmId: FIRM_ID, name: "Advisor Notes", isSystem: true })
    .returning({ id: crmDocumentFolders.id });
  siblingId = sibling.id;

  const [rootDoc] = await db
    .insert(crmHouseholdDocuments)
    .values({
      householdId: household.id,
      filename: "shared.pdf",
      storageProvider: "vercel-blob",
      storageKey: `crm/${household.id}/shared.pdf`,
      mimeType: "application/pdf",
      folderId: rootId,
    })
    .returning();
  rootDocId = rootDoc.id;

  const [siblingDoc] = await db
    .insert(crmHouseholdDocuments)
    .values({
      householdId: household.id,
      filename: "secret.pdf",
      storageProvider: "vercel-blob",
      storageKey: `crm/${household.id}/secret.pdf`,
      mimeType: "application/pdf",
      folderId: siblingId,
    })
    .returning();
  siblingDocId = siblingDoc.id;

  mockResolvePortalClient.mockResolvedValue({
    clientId,
    mode: "client",
    clerkUserId: "user_portal_doc_routes",
  });
});

afterAll(cleanup);

describe("GET /api/portal/documents", () => {
  it("lists only docs in the shared root", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://x/api/portal/documents"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.documents.map((d: { filename: string }) => d.filename)).toEqual(["shared.pdf"]);
  });
});

describe("GET /api/portal/documents/[docId]", () => {
  it("downloads a doc that lives in the shared root", async () => {
    mockGet.mockResolvedValue({ statusCode: 200, stream: streamOf("%PDF-1.4") });
    const { GET } = await import("../[docId]/route");
    const res = await GET(new NextRequest("http://x"), ctx(rootDocId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="shared.pdf"');
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("shared.pdf"), { access: "private" });
  });

  it("returns a uniform 404 for a doc in an advisor-only sibling folder (cross-boundary)", async () => {
    const { GET } = await import("../[docId]/route");
    const res = await GET(new NextRequest("http://x"), ctx(siblingDocId));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/portal/documents/[docId]", () => {
  it("deletes a doc that lives in the shared root", async () => {
    const { DELETE } = await import("../[docId]/route");
    const res = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx(rootDocId));
    expect(res.status).toBe(200);
    const row = await db.query.crmHouseholdDocuments.findFirst({ where: eq(crmHouseholdDocuments.id, rootDocId) });
    expect(row).toBeUndefined();
  });

  it("returns a uniform 404 for a sibling-folder doc and leaves the row in place", async () => {
    const { DELETE } = await import("../[docId]/route");
    const res = await DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx(siblingDocId));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    const row = await db.query.crmHouseholdDocuments.findFirst({ where: eq(crmHouseholdDocuments.id, siblingDocId) });
    expect(row).toBeDefined();
  });
});

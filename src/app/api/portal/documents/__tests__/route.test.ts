import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
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
  mockDel,
  mockGet,
  mockHead,
  mockGenerateClientToken,
} = vi.hoisted(() => ({
  mockResolvePortalClient: vi.fn(),
  mockRequirePortalActiveSubscription: vi.fn(),
  mockRequireEditEnabled: vi.fn(),
  mockDel: vi.fn(),
  mockGet: vi.fn(),
  mockHead: vi.fn(),
  mockGenerateClientToken: vi.fn(),
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
  del: (...args: unknown[]) => mockDel(...args),
  get: (...args: unknown[]) => mockGet(...args),
  head: (...args: unknown[]) => mockHead(...args),
}));
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => mockGenerateClientToken(...args),
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
let householdId: string;
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
  householdId = household.id;

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

const postJson = (body: unknown) =>
  new NextRequest("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/portal/documents/upload-token", () => {
  it("issues a token for a fresh pathname in the household's portal folder, capped at 50 MB", async () => {
    mockGenerateClientToken.mockResolvedValue("client-token");
    const { POST } = await import("../upload-token/route");
    const res = await POST(postJson({ filename: "scan.pdf", folderId: null }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.clientToken).toBe("client-token");
    expect(json.pathname).toMatch(new RegExp(`^crm/${householdId}/portal/\\d+-[0-9a-f-]{36}-scan\\.pdf$`));
    expect(mockGenerateClientToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: json.pathname, maximumSizeInBytes: 50 * 1024 * 1024 }),
    );
  });

  it("404s an advisor-only folder", async () => {
    const { POST } = await import("../upload-token/route");
    const res = await POST(postJson({ filename: "scan.pdf", folderId: siblingId }));
    expect(res.status).toBe(404);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/portal/documents (file an uploaded blob)", () => {
  const issued = () => `crm/${householdId}/portal/${Date.now()}-${randomUUID()}-scan.pdf`;

  it("files a PDF the browser uploaded, with the size Blob reports", async () => {
    const pathname = issued();
    mockHead.mockResolvedValue({ size: 6_000_000, contentType: "application/pdf" });
    mockGet.mockResolvedValue({ statusCode: 200, stream: streamOf("%PDF-1.7") });
    const { POST } = await import("../route");
    const res = await POST(postJson({ pathname, filename: "scan.pdf", folderId: null }));
    expect(res.status).toBe(201);
    const { document } = await res.json();
    expect(document).toMatchObject({ filename: "scan.pdf", sizeBytes: 6_000_000, folderId: rootId });
    const row = await db.query.crmHouseholdDocuments.findFirst({ where: eq(crmHouseholdDocuments.id, document.id) });
    expect(row).toMatchObject({ storageKey: pathname, mimeType: "application/pdf" });
    expect(mockGet).toHaveBeenCalledWith(pathname, { access: "private", headers: { Range: "bytes=0-4095" } });
  });

  it("404s a pathname outside this household's portal folder without touching Blob", async () => {
    const { POST } = await import("../route");
    const other = randomUUID();
    const tail = `${Date.now()}-${randomUUID()}-scan.pdf`;
    for (const pathname of [
      `crm/${other}/portal/${tail}`,
      `crm/${householdId}/${tail}`, // an advisor upload's shape
      `crm/${householdId}/portal/${tail}/../../../${other}/portal/${tail}`,
      `crm/${householdId}/portal/${tail}\\..\\..\\${other}`,
    ]) {
      const res = await POST(postJson({ pathname, filename: "scan.pdf", folderId: null }));
      expect(res.status, pathname).toBe(404);
    }
    expect(mockHead).not.toHaveBeenCalled();
  });

  it("refuses to file the same blob twice", async () => {
    const pathname = issued();
    mockHead.mockResolvedValue({ size: 100, contentType: "application/pdf" });
    mockGet.mockImplementation(async () => ({ statusCode: 200, stream: streamOf("%PDF-1.7") }));
    const { POST } = await import("../route");
    expect((await POST(postJson({ pathname, filename: "scan.pdf", folderId: null }))).status).toBe(201);
    expect((await POST(postJson({ pathname, filename: "scan.pdf", folderId: null }))).status).toBe(404);
  });

  it("files any type of file, storing markup as octet-stream whatever the blob claims", async () => {
    const pathname = issued();
    mockHead.mockResolvedValue({ size: 40, contentType: "application/pdf" });
    mockGet.mockResolvedValue({ statusCode: 200, stream: streamOf("<svg onload=alert(1)>") });
    const { POST } = await import("../route");
    const res = await POST(postJson({ pathname, filename: "scan.pdf", folderId: null }));
    expect(res.status).toBe(201);
    expect(mockDel).not.toHaveBeenCalled();
    const row = await db.query.crmHouseholdDocuments.findFirst({ where: eq(crmHouseholdDocuments.storageKey, pathname) });
    expect(row?.mimeType).toBe("application/octet-stream");
  });
});

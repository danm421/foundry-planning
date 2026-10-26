// src/app/(app)/clients/[id]/details/import/[importId]/fact-finder/__tests__/page.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/clients/page-access", () => ({ requireClientPageAccess: vi.fn() }));
vi.mock("@/lib/fact-finder/persist", () => ({ listLiveFiles: vi.fn() }));
vi.mock("@/lib/imports/client-documents", () => ({ listClientDocuments: vi.fn() }));
vi.mock("@/components/fact-finder/fact-finder-screen", () => ({ FactFinderScreen: () => null }));

import FactFinderPage from "../page";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { listLiveFiles } from "@/lib/fact-finder/persist";
import { emptyFactFinderState, readFactFinderState } from "@/lib/fact-finder/state";
import { listClientDocuments, type ClientDocumentView } from "@/lib/imports/client-documents";
import { FactFinderScreen } from "@/components/fact-finder/fact-finder-screen";
import { FinishedImportNotice } from "@/components/fact-finder/finished-import-notice";
import type { FactFinderScreenProps } from "@/components/fact-finder/screen-types";

const PAYLOAD = { chat: { surface: "chat" }, factFinder: { ...emptyFactFinderState(), version: 4 } };
const CLOSED = { at: "2026-10-15T12:00:00.000Z", by: "user_1", saved: [], leftOut: [] };
const DOCUMENT: ClientDocumentView = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "brokerage-statement.pdf",
  sizeBytes: 245_760,
  source: "data_collection",
  typeLabel: "Account statement",
};

/** A drizzle select chain that resolves to `result` however it's continued. */
function selectReturning(result: unknown[]) {
  const query = Promise.resolve(result) as Promise<unknown[]> & Record<"from" | "where" | "orderBy" | "limit", () => unknown>;
  query.from = query.where = query.orderBy = query.limit = () => query;
  return query;
}
/** The page's selects in order: the import row, then (only when it gets that far) the co-client's family member. */
function selects(imp: unknown[], coClient?: unknown[]) {
  vi.mocked(db.select).mockReturnValueOnce(selectReturning(imp) as never);
  if (coClient) vi.mocked(db.select).mockReturnValueOnce(selectReturning(coClient) as never);
}
const run = () => FactFinderPage({ params: Promise.resolve({ id: "c1", importId: "i1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset(); // drops selects a redirect or the notice left unused
  vi.mocked(auth).mockResolvedValue({ userId: "u1", orgId: "org_1" } as never);
  vi.mocked(requireClientPageAccess).mockResolvedValue({
    client: {}, firmId: "org_1", permission: "edit", access: "own",
  } as never);
  vi.mocked(listLiveFiles).mockResolvedValue([
    {
      id: "f1",
      blobUrl: "https://blob.example/private/hendricks.pdf",
      originalFilename: "hendricks-fact-finder.pdf",
      detectedKind: "pdf",
      documentType: "auto",
    },
  ]);
  vi.mocked(listClientDocuments).mockResolvedValue([DOCUMENT]);
});

describe("fact finder page", () => {
  it("hands the screen the fact finder and the files without their storage address", async () => {
    selects([{ status: "draft", payloadJson: PAYLOAD }], [{ id: "fm2" }]);
    const el = (await run()) as ReactElement<FactFinderScreenProps>;

    expect(requireClientPageAccess).toHaveBeenCalledWith("c1");
    expect(listLiveFiles).toHaveBeenCalledWith("i1");
    expect(listClientDocuments).toHaveBeenCalledWith("c1", "org_1");
    expect(el.type).toBe(FactFinderScreen);
    expect(el.props).toEqual({
      clientId: "c1",
      importId: "i1",
      initialState: readFactFinderState(PAYLOAD),
      initialFiles: [{ id: "f1", name: "hendricks-fact-finder.pdf", documentType: "auto" }],
      hasCoClient: true,
      clientDocuments: [DOCUMENT],
    });
    expect(el.props.initialState.version).toBe(4);
    expect(JSON.stringify(el.props)).not.toContain("blob.example");
  });

  it("tells the screen the plan has no co-client when there is no co-client family member", async () => {
    selects([{ status: "draft", payloadJson: PAYLOAD }], []);
    const el = (await run()) as ReactElement<FactFinderScreenProps>;
    expect(el.props.hasCoClient).toBe(false);
  });

  it("opens a statement-chat draft from before the switch as a fact finder import, its old chat ignored", async () => {
    const legacy = { chat: { surface: "chat", turns: [{ role: "user", text: "Add the Schwab IRA" }] } };
    selects([{ status: "review", payloadJson: legacy }], []);
    const el = (await run()) as ReactElement<FactFinderScreenProps>;
    expect(el.type).toBe(FactFinderScreen);
    expect(el.props.initialState).toEqual(emptyFactFinderState());
    expect(el.props.initialFiles).toEqual([{ id: "f1", name: "hendricks-fact-finder.pdf", documentType: "auto" }]);
  });

  it("offers none of the client's documents on a saved import", async () => {
    const saved = { factFinder: { ...emptyFactFinderState(), version: 6, closed: CLOSED } };
    selects([{ status: "committed", payloadJson: saved }], []);
    const el = (await run()) as ReactElement<FactFinderScreenProps>;
    expect(el.type).toBe(FactFinderScreen);
    expect(el.props.clientDocuments).toEqual([]);
    expect(listClientDocuments).not.toHaveBeenCalled();
  });

  it("shows a statement-chat import finished before the switch as a notice, and loads nothing else", async () => {
    selects([
      {
        status: "committed",
        payloadJson: { chat: { surface: "chat" } },
        committedAt: new Date("2026-10-08T15:30:00.000Z"),
        updatedAt: new Date("2026-10-09T09:00:00.000Z"),
      },
    ]);
    const el = (await run()) as ReactElement<{ clientId: string; finishedAt: string }>;
    expect(el.type).toBe(FinishedImportNotice);
    expect(el.props).toEqual({ clientId: "c1", finishedAt: "2026-10-08T15:30:00.000Z" });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(listLiveFiles).not.toHaveBeenCalled();
    expect(listClientDocuments).not.toHaveBeenCalled();
  });

  it("is not found for a client shared from another firm or a missing import", async () => {
    vi.mocked(requireClientPageAccess).mockResolvedValueOnce({
      client: {}, firmId: "org_2", permission: "edit", access: "shared",
    } as never);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.select).not.toHaveBeenCalled();

    selects([]);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("opens for a teammate's edit share inside the same firm", async () => {
    vi.mocked(requireClientPageAccess).mockResolvedValueOnce({
      client: {}, firmId: "org_1", permission: "edit", access: "shared",
    } as never);
    selects([{ status: "draft", payloadJson: PAYLOAD }], []);
    expect(((await run()) as ReactElement).type).toBe(FactFinderScreen);
  });

  it("sends a wizard import to the Review Wizard", async () => {
    selects([{ status: "review", payloadJson: { payload: {} } }]);
    // An Error compares the whole message: the fact finder's own address starts the same way.
    await expect(run()).rejects.toThrow(new Error("NEXT_REDIRECT /clients/c1/details/import/i1"));
    expect(listLiveFiles).not.toHaveBeenCalled();
  });

  it("sends a discarded import back to the imports list", async () => {
    selects([{ status: "discarded", payloadJson: PAYLOAD }]);
    await expect(run()).rejects.toThrow(new Error("NEXT_REDIRECT /clients/c1/details/import"));
  });
});

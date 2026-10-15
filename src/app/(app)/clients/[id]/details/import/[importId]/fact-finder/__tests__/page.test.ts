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
vi.mock("@/components/fact-finder/fact-finder-screen", () => ({ FactFinderScreen: () => null }));

import FactFinderPage from "../page";
import { db } from "@/db";
import { requireClientPageAccess } from "@/lib/clients/page-access";
import { listLiveFiles } from "@/lib/fact-finder/persist";
import { emptyFactFinderState, readFactFinderState } from "@/lib/fact-finder/state";
import { FactFinderScreen } from "@/components/fact-finder/fact-finder-screen";
import type { FactFinderScreenProps } from "@/components/fact-finder/screen-types";

const PAYLOAD = { chat: { surface: "chat" }, factFinder: { ...emptyFactFinderState(), version: 4 } };

/** A drizzle select chain that resolves to `result` however it's continued. */
function selectReturning(result: unknown[]) {
  const query = Promise.resolve(result) as Promise<unknown[]> & Record<"from" | "where" | "orderBy" | "limit", () => unknown>;
  query.from = query.where = query.orderBy = query.limit = () => query;
  return query;
}
/** The page's selects in order: the import row, then (only when it gets that far) the entities and the co-client's family member. */
function selects(imp: unknown[], entities?: unknown[], coClient: unknown[] = []) {
  vi.mocked(db.select).mockReturnValueOnce(selectReturning(imp) as never);
  if (entities) {
    vi.mocked(db.select).mockReturnValueOnce(selectReturning(entities) as never);
    vi.mocked(db.select).mockReturnValueOnce(selectReturning(coClient) as never);
  }
}
const run = () => FactFinderPage({ params: Promise.resolve({ id: "c1", importId: "i1" }) });

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("fact finder page", () => {
  it("hands the screen the fact finder, the files without their storage address, and the client's entities", async () => {
    selects([{ status: "draft", payloadJson: PAYLOAD }], [{ id: "e1", name: "Hendricks Family Trust" }], [{ id: "fm2" }]);
    const el = (await run()) as ReactElement<FactFinderScreenProps>;

    expect(requireClientPageAccess).toHaveBeenCalledWith("c1");
    expect(listLiveFiles).toHaveBeenCalledWith("i1");
    expect(el.type).toBe(FactFinderScreen);
    expect(el.props).toEqual({
      clientId: "c1",
      importId: "i1",
      initialState: readFactFinderState(PAYLOAD),
      initialFiles: [{ id: "f1", name: "hendricks-fact-finder.pdf", documentType: "auto" }],
      entities: [{ id: "e1", name: "Hendricks Family Trust" }],
      hasCoClient: true,
    });
    expect(el.props.initialState.version).toBe(4);
    expect(JSON.stringify(el.props)).not.toContain("blob.example");
  });

  it("tells the screen the plan has no co-client when there is no co-client family member", async () => {
    selects([{ status: "draft", payloadJson: PAYLOAD }], [], []);
    const el = (await run()) as ReactElement<FactFinderScreenProps>;
    expect(el.props.hasCoClient).toBe(false);
  });

  it("is not found for a client shared from another firm, a missing import, or an import that isn't a fact finder", async () => {
    vi.mocked(requireClientPageAccess).mockResolvedValueOnce({
      client: {}, firmId: "org_2", permission: "edit", access: "shared",
    } as never);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.select).not.toHaveBeenCalled();

    selects([]);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");

    selects([{ status: "draft", payloadJson: { payload: {} } }]);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listLiveFiles).not.toHaveBeenCalled();
  });

  it("sends a discarded import back to the imports list", async () => {
    selects([{ status: "discarded", payloadJson: PAYLOAD }]);
    await expect(run()).rejects.toThrow("NEXT_REDIRECT /clients/c1/details/import");
  });
});

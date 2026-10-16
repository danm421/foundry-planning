// src/app/(app)/clients/[id]/details/import/[importId]/__tests__/import-flow-content.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/investments/growth-context", () => ({ loadImportGrowthContext: vi.fn() }));
vi.mock("@/lib/imports/import-milestones", () => ({ loadImportMilestones: vi.fn() }));
vi.mock("@/lib/imports/client-documents", () => ({ listClientDocuments: vi.fn() }));
vi.mock("../import-flow", () => ({ default: () => null }));

import { ImportFlowContent } from "../import-flow-content";
import ImportFlow from "../import-flow";
import { db } from "@/db";
import { getOrgId } from "@/lib/db-helpers";

/** A drizzle select chain that resolves to `result` however it's continued. */
function selectReturning(result: unknown[]) {
  const query = Promise.resolve(result) as Promise<unknown[]> & Record<"from" | "where" | "orderBy", () => unknown>;
  query.from = query.where = query.orderBy = () => query;
  return query;
}
/** The content's selects in order: the client, the import, then (only when it gets that far) the files. */
function selects(imp: Record<string, unknown>) {
  vi.mocked(db.select)
    .mockReturnValueOnce(selectReturning([{ id: "c1" }]) as never)
    .mockReturnValueOnce(selectReturning([{ id: "i1", mode: "onboarding", scenarioId: null, notes: null, perTabCommittedAt: {}, ...imp }]) as never)
    .mockReturnValueOnce(selectReturning([]) as never);
}
const run = () => ImportFlowContent({ clientId: "c1", importId: "i1" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockReset(); // drops the files select a redirect left unused
  vi.mocked(getOrgId).mockResolvedValue("org_1");
});

describe("the Review Wizard's content", () => {
  it.each([
    ["a fact finder import", { factFinder: { version: 2 } }],
    ["a statement-chat import from before the switch", { chat: { surface: "chat" } }],
  ])("sends %s to the fact finder screen before loading anything else", async (_kind, payloadJson) => {
    selects({ status: "review", payloadJson });
    await expect(run()).rejects.toThrow(new Error("NEXT_REDIRECT /clients/c1/details/import/i1/fact-finder"));
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("still shows a wizard import in the wizard", async () => {
    selects({ status: "review", payloadJson: {} });
    const el = (await run()) as ReactElement;
    expect(el.type).toBe(ImportFlow);
  });

  it("still sends a discarded import back to the imports list", async () => {
    selects({ status: "discarded", payloadJson: { factFinder: { version: 2 } } });
    await expect(run()).rejects.toThrow(new Error("NEXT_REDIRECT /clients/c1/details/import"));
  });
});

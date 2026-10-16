// src/app/(app)/clients/[id]/details/import/[importId]/chat/__tests__/page.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock("@/lib/clients/page-access", () => ({ requireClientPageAccess: vi.fn() }));

import StatementChatPage from "../page";
import { redirect } from "next/navigation";
import { requireClientPageAccess } from "@/lib/clients/page-access";

const run = () => StatementChatPage({ params: Promise.resolve({ id: "c1", importId: "i1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientPageAccess).mockResolvedValue({
    client: {}, firmId: "org_1", permission: "edit", access: "own",
  } as never);
});

describe("statement chat's old address", () => {
  // Bookmarks and browser history: the fact finder screen sends a wizard import on to the wizard, and shows a finished one read-only.
  it("checks client access, then sends every import to the fact finder screen", async () => {
    await expect(run()).rejects.toThrow(new Error("NEXT_REDIRECT /clients/c1/details/import/i1/fact-finder"));
    expect(requireClientPageAccess).toHaveBeenCalledWith("c1");
    expect(vi.mocked(requireClientPageAccess).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0],
    );
  });

  it("redirects nowhere when the advisor can't open the client", async () => {
    vi.mocked(requireClientPageAccess).mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    await expect(run()).rejects.toThrow(new Error("NEXT_NOT_FOUND"));
    expect(redirect).not.toHaveBeenCalled();
  });
});

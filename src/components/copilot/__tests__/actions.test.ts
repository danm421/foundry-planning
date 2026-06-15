// src/components/copilot/__tests__/actions.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/domain/copilot/conversations", () => ({
  listMyConversations: vi.fn(),
  userOwnsConversation: vi.fn(),
}));
vi.mock("@/domain/copilot/checkpointer", () => ({ getCheckpointer: vi.fn() }));
vi.mock("@/domain/copilot/transcript", () => ({ toUiMessages: vi.fn(() => []) }));

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import * as convos from "@/domain/copilot/conversations";
import { listMyConversations, loadConversationMessages } from "../actions";

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
});

describe("copilot actions", () => {
  it("listMyConversations passes the derived user+firm to the DB helper", async () => {
    vi.mocked(convos.listMyConversations).mockResolvedValue([{ id: "c1" }] as never);
    const rows = await listMyConversations();
    expect(convos.listMyConversations).toHaveBeenCalledWith("user_1", "org_1");
    expect(rows).toEqual([{ id: "c1" }]);
  });

  it("loadConversationMessages rejects a conversation the user does not own (IDOR)", async () => {
    vi.mocked(convos.userOwnsConversation).mockResolvedValue(false);
    await expect(loadConversationMessages("c_other")).rejects.toThrow();
    expect(convos.userOwnsConversation).toHaveBeenCalledWith("c_other", "user_1");
  });
});

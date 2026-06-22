// src/components/forge/__tests__/actions.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/domain/forge/conversations", () => ({
  listMyConversations: vi.fn(),
  userOwnsConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
vi.mock("@/domain/forge/checkpointer", () => ({ getCheckpointer: vi.fn() }));
vi.mock("@/domain/forge/transcript", () => ({ toUiMessages: vi.fn(() => []) }));

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import * as convos from "@/domain/forge/conversations";
import {
  listMyConversations,
  loadConversationMessages,
  renameConversation,
  deleteConversation,
} from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
});

describe("forge actions", () => {
  describe("listMyConversations", () => {
    it("passes the derived user+firm to the DB helper (no clientId)", async () => {
      vi.mocked(convos.listMyConversations).mockResolvedValue([{ id: "c1" }] as never);
      const rows = await listMyConversations();
      expect(convos.listMyConversations).toHaveBeenCalledWith("user_1", "org_1", undefined);
      expect(rows).toEqual([{ id: "c1" }]);
    });

    it("forwards clientId to the domain layer when provided", async () => {
      vi.mocked(convos.listMyConversations).mockResolvedValue([{ id: "c1" }] as never);
      await listMyConversations("c1");
      expect(convos.listMyConversations).toHaveBeenCalledWith("user_1", "org_1", "c1");
    });
  });

  describe("loadConversationMessages", () => {
    it("rejects a conversation the user does not own (IDOR)", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(false);
      await expect(loadConversationMessages("c_other")).rejects.toThrow();
      expect(convos.userOwnsConversation).toHaveBeenCalledWith("c_other", "user_1");
    });
  });

  describe("renameConversation", () => {
    it("throws and does not call domain when user does not own the conversation", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(false);
      await expect(renameConversation("c_other", "New Title")).rejects.toThrow();
      expect(convos.renameConversation).not.toHaveBeenCalled();
    });

    it("throws and does not call domain when title is empty", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(true);
      await expect(renameConversation("c1", "   ")).rejects.toThrow();
      expect(convos.renameConversation).not.toHaveBeenCalled();
    });

    it("throws and does not call domain when title is an empty string", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(true);
      await expect(renameConversation("c1", "")).rejects.toThrow();
      expect(convos.renameConversation).not.toHaveBeenCalled();
    });

    it("delegates to domain with sanitized title when owner", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(true);
      vi.mocked(convos.renameConversation).mockResolvedValue(undefined);
      await renameConversation("c1", "  My Title  ");
      expect(convos.renameConversation).toHaveBeenCalledWith("c1", "user_1", "My Title");
    });

    it("truncates title to 80 chars", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(true);
      vi.mocked(convos.renameConversation).mockResolvedValue(undefined);
      const longTitle = "A".repeat(100);
      await renameConversation("c1", longTitle);
      expect(convos.renameConversation).toHaveBeenCalledWith("c1", "user_1", "A".repeat(80));
    });
  });

  describe("deleteConversation", () => {
    it("throws and does not call domain when user does not own the conversation", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(false);
      await expect(deleteConversation("c_other")).rejects.toThrow();
      expect(convos.deleteConversation).not.toHaveBeenCalled();
    });

    it("delegates to domain when owner", async () => {
      vi.mocked(convos.userOwnsConversation).mockResolvedValue(true);
      vi.mocked(convos.deleteConversation).mockResolvedValue(undefined);
      await deleteConversation("c1");
      expect(convos.deleteConversation).toHaveBeenCalledWith("c1", "user_1");
    });
  });
});

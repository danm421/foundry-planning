// src/components/forge/__tests__/actions.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/domain/forge/conversations", () => ({
  listMyConversations: vi.fn(),
  findOwnedConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
vi.mock("@/domain/forge/checkpointer", () => ({ getCheckpointer: vi.fn() }));
vi.mock("@/domain/forge/transcript", () => ({ toUiMessages: vi.fn(() => []) }));

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { getCheckpointer } from "@/domain/forge/checkpointer";
import { toUiMessages } from "@/domain/forge/transcript";
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
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true, permission: "edit", firmId: "org_1", access: "own",
  });
  vi.mocked(toUiMessages).mockReturnValue([]);
});

describe("forge actions", () => {
  describe("listMyConversations", () => {
    it("passes the derived user+firm to the DB helper for global threads (null clientId)", async () => {
      vi.mocked(convos.listMyConversations).mockResolvedValue([{ id: "c1" }] as never);
      const rows = await listMyConversations(null);
      expect(convos.listMyConversations).toHaveBeenCalledWith("user_1", "org_1", null);
      expect(rows).toEqual([{ id: "c1" }]);
      expect(verifyClientAccess).not.toHaveBeenCalled();
    });

    it("lists only global threads when no clientId is sent", async () => {
      vi.mocked(convos.listMyConversations).mockResolvedValue([] as never);
      await listMyConversations(undefined as never);
      expect(convos.listMyConversations).toHaveBeenCalledWith("user_1", "org_1", null);
    });

    it("forwards clientId to the domain layer when provided", async () => {
      vi.mocked(convos.listMyConversations).mockResolvedValue([{ id: "c1" }] as never);
      await listMyConversations("c1");
      expect(convos.listMyConversations).toHaveBeenCalledWith("user_1", "org_1", "c1");
    });

    it("lists nothing for a client the caller can no longer open", async () => {
      vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
      vi.mocked(convos.listMyConversations).mockResolvedValue([{ id: "c_x" }] as never);
      expect(await listMyConversations("client_X")).toEqual([]);
      expect(convos.listMyConversations).not.toHaveBeenCalled();
    });
  });

  describe("loadConversationMessages", () => {
    it("rejects a conversation the user does not own (IDOR)", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue(null);
      await expect(loadConversationMessages("c_other")).rejects.toThrow();
      expect(convos.findOwnedConversation).toHaveBeenCalledWith("c_other", "user_1", "org_1");
    });

    describe("a thread the caller created about client X", () => {
      beforeEach(() => {
        vi.mocked(getCheckpointer).mockReturnValue({
          getTuple: async () => ({ checkpoint: { channel_values: { messages: [{}] } }, pendingWrites: [] }),
        } as never);
        vi.mocked(toUiMessages).mockReturnValue([
          { role: "assistant", text: "Client X total assets $1,234,567" },
        ]);
      });

      it("refuses to reload it once the caller is signed in to a different firm", async () => {
        vi.mocked(requireOrgId).mockResolvedValue("org_B");
        // The thread is stored under org_A, so the lookup scoped to org_B finds nothing.
        vi.mocked(convos.findOwnedConversation).mockResolvedValue(null);
        await expect(loadConversationMessages("c_x")).rejects.toThrow("Conversation not found");
        expect(convos.findOwnedConversation).toHaveBeenCalledWith("c_x", "user_1", "org_B");
      });

      it("refuses to reload it once the caller can no longer open client X", async () => {
        vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: "client_X" });
        vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
        await expect(loadConversationMessages("c_x")).rejects.toThrow("Conversation not found");
        expect(verifyClientAccess).toHaveBeenCalledWith("client_X");
      });

      it("reloads it while the caller can still open client X", async () => {
        vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: "client_X" });
        vi.mocked(verifyClientAccess).mockResolvedValue({
          ok: true, permission: "view", firmId: "org_1", access: "own",
        });
        const loaded = await loadConversationMessages("c_x");
        expect(loaded.messages).toEqual([{ role: "assistant", text: "Client X total assets $1,234,567" }]);
      });
    });

    it("reloads a global thread without a client check", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: null });
      vi.mocked(getCheckpointer).mockReturnValue({ getTuple: async () => undefined } as never);
      await expect(loadConversationMessages("c_g")).resolves.toEqual({ messages: [], approval: null });
      expect(verifyClientAccess).not.toHaveBeenCalled();
    });
  });

  describe("renameConversation", () => {
    it("throws and does not call domain when user does not own the conversation", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue(null);
      await expect(renameConversation("c_other", "New Title")).rejects.toThrow();
      expect(convos.renameConversation).not.toHaveBeenCalled();
    });

    it("throws and does not call domain when title is empty", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: null });
      await expect(renameConversation("c1", "   ")).rejects.toThrow();
      expect(convos.renameConversation).not.toHaveBeenCalled();
    });

    it("throws and does not call domain when title is an empty string", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: null });
      await expect(renameConversation("c1", "")).rejects.toThrow();
      expect(convos.renameConversation).not.toHaveBeenCalled();
    });

    it("delegates to domain with sanitized title when owner", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: null });
      vi.mocked(convos.renameConversation).mockResolvedValue(undefined);
      await renameConversation("c1", "  My Title  ");
      expect(convos.renameConversation).toHaveBeenCalledWith("c1", "user_1", "My Title");
    });

    it("truncates title to 80 chars", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: null });
      vi.mocked(convos.renameConversation).mockResolvedValue(undefined);
      const longTitle = "A".repeat(100);
      await renameConversation("c1", longTitle);
      expect(convos.renameConversation).toHaveBeenCalledWith("c1", "user_1", "A".repeat(80));
    });
  });

  it("refuses to rename or delete a thread about a client the caller can no longer open", async () => {
    vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: "client_X" });
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false });
    await expect(renameConversation("c_x", "New Title")).rejects.toThrow("Conversation not found");
    await expect(deleteConversation("c_x")).rejects.toThrow("Conversation not found");
    expect(convos.renameConversation).not.toHaveBeenCalled();
    expect(convos.deleteConversation).not.toHaveBeenCalled();
  });

  describe("deleteConversation", () => {
    it("throws and does not call domain when user does not own the conversation", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue(null);
      await expect(deleteConversation("c_other")).rejects.toThrow();
      expect(convos.deleteConversation).not.toHaveBeenCalled();
    });

    it("delegates to domain when owner", async () => {
      vi.mocked(convos.findOwnedConversation).mockResolvedValue({ clientId: null });
      vi.mocked(convos.deleteConversation).mockResolvedValue(undefined);
      await deleteConversation("c1");
      expect(convos.deleteConversation).toHaveBeenCalledWith("c1", "user_1");
    });
  });
});

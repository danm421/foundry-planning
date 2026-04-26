import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyAlreadyOwned,
  applyGiftThisYear,
  applyBequestAtDeath,
} from "@/app/(app)/clients/[id]/estate-planning/drop-handlers";

const mockFetch = vi.fn();
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
});

describe("drop-handlers", () => {
  describe("applyAlreadyOwned", () => {
    it("PUTs the account flipping ownerEntityId to the trust id", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "a1" }) }); // PUT
      const inverse = await applyAlreadyOwned({
        clientId: "c1",
        accountId: "a1",
        previousOwnerEntityId: null,
        targetEntityId: "t1",
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/clients/c1/accounts/a1",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining(`"ownerEntityId":"t1"`),
        }),
      );
      // Inverse re-flips to the original owner
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "a1" }) });
      await inverse();
      const lastBody = JSON.parse((mockFetch.mock.calls.at(-1)![1] as RequestInit).body as string);
      expect(lastBody.ownerEntityId).toBeNull();
    });
  });

  describe("applyGiftThisYear", () => {
    it("POSTs a gift at the current year and returns an inverse that DELETEs it", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "g1" }) }) // POST
        .mockResolvedValueOnce({ ok: true, status: 204 }); // DELETE inverse
      const inverse = await applyGiftThisYear({
        clientId: "c1",
        currentYear: 2026,
        amount: 1_000_000,
        grantor: "client",
        recipientEntityId: "t1",
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body).toEqual(expect.objectContaining({
        year: 2026,
        amount: 1_000_000,
        grantor: "client",
        recipientEntityId: "t1",
      }));
      await inverse();
      expect(mockFetch.mock.calls.at(-1)![0]).toBe("/api/clients/c1/gifts/g1");
      expect((mockFetch.mock.calls.at(-1)![1] as RequestInit).method).toBe("DELETE");
    });
  });

  describe("applyBequestAtDeath — when no will exists", () => {
    it("POSTs a new will + bequest, returns an inverse that DELETEs the will", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "w1", warnings: [] }) }) // POST will
        .mockResolvedValueOnce({ ok: true, status: 204 }); // DELETE inverse
      const inverse = await applyBequestAtDeath({
        clientId: "c1",
        grantor: "client",
        existingWill: null,
        bequest: {
          name: "Brokerage A",
          assetMode: "specific",
          accountId: "a1",
          percentage: 100,
          condition: "always",
          recipients: [
            { recipientKind: "entity", recipientId: "t1", percentage: 100, sortOrder: 0 },
          ],
        },
      });
      const postBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(postBody.grantor).toBe("client");
      expect(postBody.bequests).toHaveLength(1);
      await inverse();
      expect(mockFetch.mock.calls.at(-1)![0]).toBe("/api/clients/c1/wills/w1");
      expect((mockFetch.mock.calls.at(-1)![1] as RequestInit).method).toBe("DELETE");
    });
  });

  describe("applyBequestAtDeath — when a will already exists", () => {
    it("PATCHes the existing will with the appended bequest, inverse PATCHes back to the original array", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // PATCH new
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // PATCH inverse
      const existingWill = {
        id: "w1",
        grantor: "client" as const,
        bequests: [
          { kind: "asset" as const, name: "Existing", assetMode: "specific" as const, accountId: "a0", percentage: 100, condition: "always" as const, sortOrder: 0, recipients: [] },
        ],
      };
      const inverse = await applyBequestAtDeath({
        clientId: "c1",
        grantor: "client",
        existingWill,
        bequest: {
          name: "Brokerage A",
          assetMode: "specific",
          accountId: "a1",
          percentage: 100,
          condition: "always",
          recipients: [
            { recipientKind: "entity", recipientId: "t1", percentage: 100, sortOrder: 0 },
          ],
        },
      });
      // First PATCH: bequests array now has 2 entries (kind:asset)
      const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(firstBody.bequests).toHaveLength(2);
      // Inverse PATCH: bequests array reverts to 1 entry
      await inverse();
      const inverseBody = JSON.parse(mockFetch.mock.calls.at(-1)![1].body as string);
      expect(inverseBody.bequests).toHaveLength(1);
      expect(inverseBody.bequests[0].name).toBe("Existing");
    });
  });
});

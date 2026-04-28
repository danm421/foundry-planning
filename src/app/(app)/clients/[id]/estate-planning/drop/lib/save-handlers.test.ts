import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  saveGiftOneTime,
  saveGiftRecurring,
  saveBequest,
  saveRetitle,
} from "./save-handlers";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("save-handlers", () => {
  it("saveGiftOneTime POSTs to /api/clients/[id]/gifts with the right body", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await saveGiftOneTime({
      clientId: "c1",
      year: 2026,
      grantor: "client",
      sourceAccountId: "a1",
      recipient: { kind: "entity", id: "ent-slat" },
      amountKind: "percent",
      percent: 0.6,
      useCrummeyPowers: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/gifts",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"recipientEntityId":"ent-slat"'),
      }),
    );
  });

  it("saveGiftRecurring POSTs to /api/clients/[id]/gifts/series", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await saveGiftRecurring({
      clientId: "c1",
      grantor: "client",
      recipient: { kind: "entity", id: "ent-slat" },
      startYear: 2026,
      endYear: 2030,
      annualAmount: 18_000,
      inflationAdjust: false,
      useCrummeyPowers: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/gifts/series",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("saveBequest mirrors when grantor is 'both'", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await saveBequest({
      clientId: "c1",
      grantorMode: "both",
      accountId: "a1",
      percentage: 100,
      condition: "if_spouse_predeceased",
      recipient: { kind: "entity", id: "ent-slat" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // tom + linda
  });

  it("saveRetitle writes via PUT /accounts/[id]/owners with merged slice", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await saveRetitle({
      clientId: "c1",
      accountId: "a1",
      currentOwners: [
        { kind: "family_member", familyMemberId: "fm-tom", percent: 0.6 },
        { kind: "family_member", familyMemberId: "fm-linda", percent: 0.4 },
      ],
      moveFrom: { kind: "family_member", id: "fm-tom" },
      moveTo: { kind: "entity", id: "ent-slat" },
      slicePct: 0.5, // half of Tom's 60% slice → 30% of asset to SLAT
    });
    // NOTE: divergence from plan pseudocode — there is no /owners sub-route.
    // Owners are persisted via PUT /api/clients/[id]/accounts/[accountId] with
    // a body of { owners: [...] }. The route's PUT handler strips owners from
    // the account update payload and writes them to account_owners separately.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/c1/accounts/a1",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // tom 30%, linda 40%, slat 30%
    expect(body.owners).toEqual([
      { kind: "family_member", familyMemberId: "fm-tom", percent: 0.3 },
      { kind: "family_member", familyMemberId: "fm-linda", percent: 0.4 },
      { kind: "entity", entityId: "ent-slat", percent: 0.3 },
    ]);
  });

  it("throws on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("Bad", { status: 400 }));
    await expect(
      saveGiftOneTime({
        clientId: "c1",
        year: 2026,
        grantor: "client",
        recipient: { kind: "entity", id: "ent-slat" },
        amountKind: "percent",
        percent: 0.6,
        useCrummeyPowers: false,
      }),
    ).rejects.toThrow(/400/);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  saveGiftOneTime,
  saveGiftRecurring,
  saveBequest,
  saveRetitle,
} from "./save-handlers";
import type { UseScenarioWriter } from "@/hooks/use-scenario-writer";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function mockSubmit(status: number, body = "{}"): UseScenarioWriter["submit"] {
  return vi.fn().mockResolvedValue(new Response(body, { status }));
}

describe("save-handlers", () => {
  it("saveGiftOneTime writes a cash-once scenario add, with the base fallback unchanged", async () => {
    const submit = mockSubmit(200);
    await saveGiftOneTime({
      clientId: "c1",
      year: 2026,
      grantor: "client",
      recipient: { kind: "entity", id: "ent-slat" },
      amountKind: "dollar",
      amount: 18_000,
      useCrummeyPowers: false,
      submit,
    });

    expect(submit).toHaveBeenCalledTimes(1);
    const [edit, fallback] = (submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(edit).toMatchObject({ op: "add", targetKind: "gift" });
    expect((edit.entity as { kind: string }).kind).toBe("cash-once");
    expect(edit.entity).toMatchObject({
      amount: 18_000,
      grantor: "client",
      recipient: { kind: "entity", id: "ent-slat" },
      crummey: false,
      eventKind: "outright",
    });
    // The base fallback must stay byte-identical to the old POST.
    expect(fallback).toMatchObject({
      url: "/api/clients/c1/gifts",
      method: "POST",
    });
    expect(fallback.body).toMatchObject({
      recipientEntityId: "ent-slat",
      amount: 18_000,
      accountId: null,
      useCrummeyPowers: false,
    });
  });

  it("saveGiftOneTime writes an asset-once scenario add when a source account is present", async () => {
    // RULING 51: saveGiftOneTime serves both cash and asset gifts. A drop from a
    // non-cash account carries sourceAccountId + amountKind:'percent' and must
    // build kind:'asset-once' (accountId + percent), mirroring giftRowToDraft.
    const submit = mockSubmit(200);
    await saveGiftOneTime({
      clientId: "c1",
      year: 2026,
      grantor: "client",
      sourceAccountId: "a1",
      recipient: { kind: "entity", id: "ent-slat" },
      amountKind: "percent",
      percent: 0.6,
      useCrummeyPowers: false,
      submit,
    });

    const [edit, fallback] = (submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(edit).toMatchObject({ op: "add", targetKind: "gift" });
    expect((edit.entity as { kind: string }).kind).toBe("asset-once");
    expect(edit.entity).toMatchObject({
      accountId: "a1",
      percent: 0.6,
      grantor: "client",
      recipient: { kind: "entity", id: "ent-slat" },
      eventKind: "outright",
    });
    expect(fallback.body).toMatchObject({
      accountId: "a1",
      recipientEntityId: "ent-slat",
      percent: 0.6,
    });
  });

  it("saveGiftRecurring writes a series scenario add, with the base fallback unchanged", async () => {
    const submit = mockSubmit(200);
    await saveGiftRecurring({
      clientId: "c1",
      grantor: "client",
      recipient: { kind: "entity", id: "ent-slat" },
      startYear: 2026,
      endYear: 2030,
      annualAmount: 18_000,
      inflationAdjust: false,
      useCrummeyPowers: true,
      submit,
    });

    expect(submit).toHaveBeenCalledTimes(1);
    const [edit, fallback] = (submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(edit).toMatchObject({ op: "add", targetKind: "gift" });
    expect((edit.entity as { kind: string }).kind).toBe("series");
    expect(edit.entity).toMatchObject({
      startYear: 2026,
      endYear: 2030,
      annualAmount: 18_000,
      amountMode: "fixed",
      inflationAdjust: false,
      grantor: "client",
      recipient: { kind: "entity", id: "ent-slat" },
      crummey: true,
    });
    // The base fallback must stay byte-identical to the old POST.
    expect(fallback).toMatchObject({
      url: "/api/clients/c1/gifts/series",
      method: "POST",
    });
    expect(fallback.body).toMatchObject({
      recipientEntityId: "ent-slat",
      annualAmount: 18_000,
      useCrummeyPowers: true,
    });
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

  // RULING 48: this test is the throw-on-failure contract's ONLY guard.
  // `submit` resolves (never rejects) even on a non-ok Response, exactly like
  // the real useScenarioWriter — so saveGiftOneTime must inspect res.ok itself
  // and throw in the same "{status} {body text}" shape postJson used to.
  it("throws on non-2xx", async () => {
    const submit = mockSubmit(400, "Bad");
    await expect(
      saveGiftOneTime({
        clientId: "c1",
        year: 2026,
        grantor: "client",
        recipient: { kind: "entity", id: "ent-slat" },
        amountKind: "percent",
        percent: 0.6,
        useCrummeyPowers: false,
        submit,
      }),
    ).rejects.toThrow(/400/);
  });

  // Same contract on the other gift handler — RULING 41 requires both.
  it("saveGiftRecurring throws on non-2xx", async () => {
    const submit = mockSubmit(400, "Bad");
    await expect(
      saveGiftRecurring({
        clientId: "c1",
        grantor: "client",
        recipient: { kind: "entity", id: "ent-slat" },
        startYear: 2026,
        endYear: 2030,
        annualAmount: 18_000,
        inflationAdjust: false,
        useCrummeyPowers: true,
        submit,
      }),
    ).rejects.toThrow(/400/);
  });
});

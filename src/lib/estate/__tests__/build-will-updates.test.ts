import { describe, it, expect } from "vitest";
import { buildWillUpdates, buildJointWillUpdates, type BuildWillUpdatesInput } from "../build-will-updates";
import type { Will, WillBequest, WillBequestRecipient } from "@/engine/types";

const account = { id: "acc-1", name: "Brokerage" };

function recipient(id: string, pct: number, sort = 0): WillBequestRecipient {
  return { recipientKind: "family_member", recipientId: id, percentage: pct, sortOrder: sort };
}

function specificBequest(id: string, accountId: string): WillBequest {
  return {
    id,
    name: "old",
    kind: "asset",
    assetMode: "specific",
    accountId,
    liabilityId: null,
    percentage: 100,
    condition: "always",
    sortOrder: 0,
    recipients: [],
  };
}

function will(id: string, grantor: "client" | "spouse", bequests: WillBequest[] = []): Will {
  return { id, grantor, bequests, residuaryRecipients: [] };
}

function makeIdGen() {
  let n = 0;
  return () => `gen-${++n}`;
}

function baseInput(over: Partial<BuildWillUpdatesInput> = {}): BuildWillUpdatesInput {
  return {
    account,
    clientWill: will("will-client", "client"),
    clientRecipients: [recipient("fm-spouse", 100)],
    clientCondition: "if_spouse_survives",
    hasSpouseRecipient: false,
    spouseCascadeRecipients: [],
    spouseWill: null,
    newId: makeIdGen(),
    ...over,
  };
}

describe("buildWillUpdates", () => {
  it("appends a new asset bequest to the client will when none exists", () => {
    const out = buildWillUpdates(baseInput());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("will-client");
    expect(out[0].bequests).toHaveLength(1);
    expect(out[0].bequests[0]).toMatchObject({
      accountId: "acc-1",
      condition: "if_spouse_survives",
      recipients: [recipient("fm-spouse", 100)],
    });
  });

  it("updates the client's existing bequest for the account in place", () => {
    const existing = specificBequest("bq-existing", "acc-1");
    const out = buildWillUpdates(
      baseInput({
        clientWill: will("will-client", "client", [existing]),
        clientRecipients: [recipient("fm-kid", 100)],
        clientCondition: "always",
      }),
    );
    expect(out[0].bequests).toHaveLength(1);
    expect(out[0].bequests[0].id).toBe("bq-existing");
    expect(out[0].bequests[0].condition).toBe("always");
    expect(out[0].bequests[0].recipients).toEqual([recipient("fm-kid", 100)]);
  });

  it("removes the existing bequest when the client's recipients are cleared", () => {
    const existing = specificBequest("bq-existing", "acc-1");
    const out = buildWillUpdates(
      baseInput({
        clientWill: will("will-client", "client", [existing]),
        clientRecipients: [],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("will-client");
    expect(out[0].bequests).toEqual([]);
  });

  it("does not append a bequest when recipients are empty and none exists", () => {
    const out = buildWillUpdates(baseInput({ clientRecipients: [] }));
    expect(out).toHaveLength(1);
    expect(out[0].bequests).toEqual([]);
  });

  it("creates a spouse will with the cascade bequest when the spouse has none", () => {
    const out = buildWillUpdates(
      baseInput({
        hasSpouseRecipient: true,
        spouseCascadeRecipients: [recipient("fm-kid", 100)],
        spouseWill: null,
      }),
    );
    expect(out).toHaveLength(2);
    const spouseWill = out.find((w) => w.grantor === "spouse")!;
    expect(spouseWill).toBeDefined();
    expect(spouseWill.bequests).toHaveLength(1);
    expect(spouseWill.bequests[0]).toMatchObject({
      accountId: "acc-1",
      condition: "always",
      recipients: [recipient("fm-kid", 100)],
    });
  });

  it("updates the spouse's existing bequest for the account in place", () => {
    const out = buildWillUpdates(
      baseInput({
        hasSpouseRecipient: true,
        spouseCascadeRecipients: [recipient("fm-kid", 100)],
        spouseWill: will("will-spouse", "spouse", [specificBequest("bq-sp", "acc-1")]),
      }),
    );
    const spouseWill = out.find((w) => w.id === "will-spouse")!;
    expect(spouseWill.bequests).toHaveLength(1);
    expect(spouseWill.bequests[0].id).toBe("bq-sp");
    expect(spouseWill.bequests[0].recipients).toEqual([recipient("fm-kid", 100)]);
  });

  it("appends a cascade bequest to an existing spouse will without one for the account", () => {
    const out = buildWillUpdates(
      baseInput({
        hasSpouseRecipient: true,
        spouseCascadeRecipients: [recipient("fm-kid", 100)],
        spouseWill: will("will-spouse", "spouse", [specificBequest("bq-other", "acc-9")]),
      }),
    );
    const spouseWill = out.find((w) => w.id === "will-spouse")!;
    expect(spouseWill.bequests.map((b) => b.accountId)).toEqual(["acc-9", "acc-1"]);
  });

  it("skips the spouse will when the spouse is a recipient but the cascade is empty", () => {
    const out = buildWillUpdates(
      baseInput({ hasSpouseRecipient: true, spouseCascadeRecipients: [] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].grantor).toBe("client");
  });

  it("does not mutate the input wills", () => {
    const clientWill = will("will-client", "client", [specificBequest("bq-existing", "acc-1")]);
    const spouseWill = will("will-spouse", "spouse");
    buildWillUpdates(
      baseInput({
        clientWill,
        hasSpouseRecipient: true,
        spouseCascadeRecipients: [recipient("fm-kid", 100)],
        spouseWill,
      }),
    );
    expect(clientWill.bequests[0].recipients).toEqual([]);
    expect(spouseWill.bequests).toEqual([]);
  });
});

describe("buildJointWillUpdates", () => {
  it("writes a specific bequest into both existing wills", () => {
    const out = buildJointWillUpdates({
      account,
      clientWill: will("will-client", "client"),
      clientRecipients: [recipient("fm-kid", 100)],
      spouseWill: will("will-spouse", "spouse"),
      spouseRecipients: [recipient("fm-kid", 100)],
      newId: makeIdGen(),
    });
    expect(out).toHaveLength(2);
    for (const w of out) {
      const b = w.bequests.find(
        (x) => x.kind === "asset" && x.assetMode === "specific" && x.accountId === "acc-1",
      );
      expect(b).toBeDefined();
      expect(b!.condition).toBe("always");
    }
  });

  it("mints the spouse will when the spouse has none and has recipients", () => {
    const out = buildJointWillUpdates({
      account,
      clientWill: will("will-client", "client"),
      clientRecipients: [recipient("fm-kid", 100)],
      spouseWill: null,
      spouseRecipients: [recipient("fm-kid", 100)],
      newId: makeIdGen(),
    });
    expect(out).toHaveLength(2);
    const spouse = out.find((w) => w.grantor === "spouse");
    expect(spouse).toBeDefined();
    expect(spouse!.bequests).toHaveLength(1);
  });

  it("does not mint a will for a grantor with no recipients", () => {
    const out = buildJointWillUpdates({
      account,
      clientWill: will("will-client", "client"),
      clientRecipients: [recipient("fm-kid", 100)],
      spouseWill: null,
      spouseRecipients: [],
      newId: makeIdGen(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].grantor).toBe("client");
  });

  it("removes an existing bequest when that grantor's recipients are cleared", () => {
    const existing = will("will-spouse", "spouse", [specificBequest("beq-1", "acc-1")]);
    const out = buildJointWillUpdates({
      account,
      clientWill: will("will-client", "client"),
      clientRecipients: [recipient("fm-kid", 100)],
      spouseWill: existing,
      spouseRecipients: [],
      newId: makeIdGen(),
    });
    const spouse = out.find((w) => w.grantor === "spouse");
    expect(spouse!.bequests).toHaveLength(0);
  });
});

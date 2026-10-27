import { describe, it, expect } from "vitest";
import type { ClientData, EntitySummary } from "@/engine/types";
import {
  applyKindPreset,
  defaultTrustName,
  evenShares,
  guidedKindOf,
  guidedTrustContext,
  initialAnswers,
  isSlat,
  spouseOf,
  stepBlocker,
  stepsFor,
  trustPeopleOptions,
  trustTypeLabel,
  type GuidedTrustAnswers,
  type PersonShare,
} from "../guided-trust";

function tree(over: Partial<ClientData> & { married?: boolean } = {}): ClientData {
  const { married = true, ...rest } = over;
  return {
    client: {
      firstName: "Dan", lastName: "Smith", dateOfBirth: "1970-05-01",
      ...(married ? { spouseName: "Jane", spouseDob: "1972-03-02" } : {}),
    },
    accounts: [],
    planSettings: { planStartYear: 2026 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Dan", lastName: "Smith" },
      ...(married
        ? [{ id: "fm-s", role: "spouse", relationship: "other", firstName: "Jane", lastName: "Smith" }]
        : []),
      { id: "fm-1", role: "child", relationship: "child", firstName: "Kid", lastName: "Smith" },
    ],
    externalBeneficiaries: [
      { id: "ex-1", name: "Red Cross", kind: "charity", charityType: "public" },
      { id: "ex-2", name: "Pat Friend", kind: "individual", charityType: "private" },
    ],
    ...rest,
  } as unknown as ClientData;
}

const ctx = (t = tree()) => guidedTrustContext(t, { 2026: 19000 });
const share = (role: "client" | "spouse", percentage = 100): PersonShare => ({
  person: { kind: "household", role }, percentage,
});
const kid: PersonShare = { person: { kind: "family_member", id: "fm-1" }, percentage: 100 };
const base = (over: Partial<GuidedTrustAnswers> = {}): GuidedTrustAnswers => ({
  ...initialAnswers("e1"), ...over,
});

describe("guidedTrustContext / initialAnswers", () => {
  it("derives married, ages and plan start", () => {
    const c = ctx();
    expect(c.isMarried).toBe(true);
    expect(c.planStartYear).toBe(2026);
    expect(c.agePeople).toEqual([
      { name: "Dan", birthYear: 1970 },
      { name: "Jane", birthYear: 1972 },
    ]);
    expect(c.annualExclusionByYear).toEqual({ 2026: 19000 });
  });
  it("unmarried tree is not married", () => {
    expect(ctx(tree({ married: false })).isMarried).toBe(false);
  });
  it("initial answers", () => {
    expect(initialAnswers("e1")).toMatchObject({
      entityId: "e1", kind: "irrevocable", grantor: "client",
      lifetime: [], remainder: [], funding: [], name: "",
    });
  });
});

describe("applyKindPreset", () => {
  it("irrevocable", () => {
    expect(applyKindPreset(base(), "irrevocable")).toMatchObject({
      kind: "irrevocable", isGrantor: true, crummeyPowers: true, accessibleToClient: false,
    });
  });
  it("slat adds the spouse to lifetime and re-splits evenly", () => {
    const a = applyKindPreset(base({ lifetime: [kid] }), "slat");
    expect(a).toMatchObject({ isGrantor: true, crummeyPowers: true, accessibleToClient: true });
    expect(a.lifetime).toEqual([
      { person: { kind: "family_member", id: "fm-1" }, percentage: 50 },
      { person: { kind: "household", role: "spouse" }, percentage: 50 },
    ]);
  });
  it("slat does not duplicate an existing spouse", () => {
    const a = applyKindPreset(base({ lifetime: [share("spouse", 60), { ...kid, percentage: 40 }] }), "slat");
    expect(a.lifetime).toHaveLength(2);
    expect(a.lifetime[0].percentage).toBe(60);
  });
  it("slat with spouse grantor adds the client", () => {
    const a = applyKindPreset(base({ grantor: "spouse" }), "slat");
    expect(a.lifetime).toEqual([share("client")]);
  });
  it("ilit / idgt / crt / clt / revocable", () => {
    expect(applyKindPreset(base(), "ilit")).toMatchObject({ crummeyPowers: true, isGrantor: false });
    expect(applyKindPreset(base(), "idgt")).toMatchObject({ isGrantor: true, crummeyPowers: false });
    expect(applyKindPreset(base(), "crt").isGrantor).toBe(false);
    expect(applyKindPreset(base(), "clt").isGrantor).toBe(true);
    const r = base({ isGrantor: false, crummeyPowers: false, accessibleToClient: true });
    expect(applyKindPreset(r, "revocable")).toMatchObject({
      kind: "revocable", isGrantor: false, crummeyPowers: false, accessibleToClient: true,
    });
  });
  it("never clears picked people", () => {
    const a = applyKindPreset(base({ lifetime: [kid], remainder: [kid] }), "ilit");
    expect(a.lifetime).toEqual([kid]);
    expect(a.remainder).toEqual([kid]);
  });
});

describe("stepsFor", () => {
  it("per kind", () => {
    expect(stepsFor("revocable")).toEqual(["type", "accounts", "review"]);
    expect(stepsFor("crt")).toEqual(["type", "setup", "review"]);
    expect(stepsFor("clt")).toEqual(["type", "setup", "review"]);
    expect(stepsFor("slat")).toEqual(["type", "people", "powers", "funding", "review"]);
    expect(stepsFor("ilit")).toEqual(["type", "people", "powers", "funding", "review"]);
  });
});

describe("stepBlocker", () => {
  const c = ctx();
  it("people", () => {
    expect(stepBlocker("people", base(), c)).toBe("Pick who can benefit while the trust runs.");
    expect(stepBlocker("people", base({ lifetime: [kid] }), c)).toBe(
      "Pick who gets what's left — the 'to heirs' figures credit them.",
    );
    expect(
      stepBlocker("people", base({ lifetime: [{ ...kid, percentage: 90 }], remainder: [kid] }), c),
    ).toBe("Shares under 'Benefits now' must add up to 100%.");
    expect(
      stepBlocker("people", base({ lifetime: [kid], remainder: [{ ...kid, percentage: 99.5 }] }), c),
    ).toBe("Shares under 'Gets what's left' must add up to 100%.");
    expect(stepBlocker("people", base({ lifetime: [kid], remainder: [kid] }), c)).toBeNull();
    expect(
      stepBlocker("people", base({ lifetime: [kid], remainder: [{ ...kid, percentage: 100.005 }] }), c),
    ).toBeNull();
  });
  it("people: a share outside 0–100 blocks even when the total is 100", () => {
    const split = [{ ...kid, percentage: -50 }, { ...share("spouse"), percentage: 150 }];
    expect(stepBlocker("people", base({ lifetime: split, remainder: [kid] }), c)).toBe(
      "Each share must be between 0% and 100%.",
    );
    expect(stepBlocker("people", base({ lifetime: [kid], remainder: split }), c)).toBe(
      "Each share must be between 0% and 100%.",
    );
  });
  it("accounts", () => {
    expect(stepBlocker("accounts", base({ kind: "revocable" }), c)).toBe(
      "Pick at least one account to move in.",
    );
    const t = tree({
      accounts: [{ id: "a1", revocableTrustName: "Smith Trust" }] as unknown as ClientData["accounts"],
    });
    expect(
      stepBlocker("accounts", base({ kind: "revocable", name: " Smith Trust ", revocableAccountIds: ["a1"] }), ctx(t)),
    ).toBe("A trust named Smith Trust already exists. Open it from the list to add accounts.");
    expect(
      stepBlocker("accounts", base({ kind: "revocable", name: "Other", revocableAccountIds: ["a1"] }), ctx(t)),
    ).toBeNull();
  });
  it("accounts: a name matches another trust whatever its case and spacing", () => {
    const t = tree({
      accounts: [{ id: "a1", revocableTrustName: "Smith Trust" }] as unknown as ClientData["accounts"],
    });
    expect(
      stepBlocker("accounts", base({ kind: "revocable", name: "  smith TRUST ", revocableAccountIds: ["a1"] }), ctx(t)),
    ).toBe("A trust named smith TRUST already exists. Open it from the list to add accounts.");
  });
  it("accounts: a base trust whose accounts were all unticked still counts", () => {
    // No working-tree account carries the name; the base does.
    const c2 = guidedTrustContext(tree(), { 2026: 19000 }, ["Smith Trust"]);
    expect(
      stepBlocker("accounts", base({ kind: "revocable", name: "Smith Trust", revocableAccountIds: ["a1"] }), c2),
    ).toBe("A trust named Smith Trust already exists. Open it from the list to add accounts.");
  });
  it("setup", () => {
    expect(stepBlocker("setup", base({ kind: "crt" }), c)).toBe("Finish the trust's payout and funding.");
    const si = { snapshot: {}, fundingAccountIds: [], newCharity: null } as unknown as GuidedTrustAnswers["splitInterest"];
    expect(stepBlocker("setup", base({ kind: "crt", splitInterest: si }), c)).toBeNull();
    expect(stepBlocker("setup", base({ kind: "clt", splitInterest: si }), c)).toBe(
      "Pick who gets what's left — the 'to heirs' figures credit them.",
    );
    expect(stepBlocker("setup", base({ kind: "clt", splitInterest: si, remainder: [kid] }), c)).toBeNull();
    const bad = [{ ...kid, percentage: 120 }, { ...share("spouse"), percentage: -20 }];
    expect(stepBlocker("setup", base({ kind: "clt", splitInterest: si, remainder: bad }), c)).toBe(
      "Each share must be between 0% and 100%.",
    );
    expect(
      stepBlocker("setup", base({ kind: "clt", splitInterest: si, remainder: [{ ...kid, percentage: 90 }] }), c),
    ).toBe("Shares under 'Gets what's left' must add up to 100%.");
  });
  it("review and pass-through steps", () => {
    expect(stepBlocker("review", base({ name: "  " }), c)).toBe("Name the trust.");
    expect(stepBlocker("review", base({ name: "X" }), c)).toBeNull();
    const withTrust = ctx(tree({ entities: [{ id: "t9", name: "Kid Smith Irrevocable Trust" }] as unknown as ClientData["entities"] }));
    expect(stepBlocker("review", base({ name: " kid smith irrevocable trust " }), withTrust)).toBe(
      "A trust named kid smith irrevocable trust already exists. Pick another name.",
    );
    expect(stepBlocker("review", base({ name: "Kid Smith Trust" }), withTrust)).toBeNull();
    for (const s of ["type", "powers", "funding"] as const) expect(stepBlocker(s, base(), c)).toBeNull();
  });
});

describe("trustPeopleOptions", () => {
  it("married lifetime: spouse first, then family, individuals, other heirs", () => {
    const o = trustPeopleOptions(tree(), "client", "lifetime");
    expect(o.map((x) => x.label)).toEqual(["Jane", "Kid (child)", "Pat Friend", "Other heirs"]);
    expect(o[0]).toMatchObject({ ref: { kind: "household", role: "spouse" } });
  });
  it("spouse grantor offers the client", () => {
    const o = trustPeopleOptions(tree(), "spouse", "lifetime");
    expect(o[0]).toMatchObject({ ref: { kind: "household", role: "client" }, label: "Dan" });
  });
  it("remainder omits the household option", () => {
    const o = trustPeopleOptions(tree(), "client", "remainder");
    expect(o.map((x) => x.label)).toEqual(["Kid (child)", "Pat Friend", "Other heirs"]);
  });
  it("unmarried has no household option; bare tree still offers other heirs", () => {
    const o = trustPeopleOptions(tree({ married: false }), "client", "lifetime");
    expect(o.some((x) => x.ref.kind === "household")).toBe(false);
    const bare = tree({ married: false, familyMembers: [], externalBeneficiaries: [] });
    for (const g of ["lifetime", "remainder"] as const) {
      expect(trustPeopleOptions(bare, "client", g)).toEqual([
        { ref: { kind: "other_heirs" }, label: "Other heirs" },
      ]);
    }
  });
});

describe("evenShares / spouseOf", () => {
  it("splits to 2dp summing to 100", () => {
    const refs = [{ kind: "other_heirs" }, { kind: "family_member", id: "a" }, { kind: "family_member", id: "b" }] as const;
    const s = evenShares([...refs]);
    expect(s.map((x) => x.percentage)).toEqual([33.34, 33.33, 33.33]);
    expect(evenShares([])).toEqual([]);
    expect(evenShares([refs[0]])[0].percentage).toBe(100);
  });
  it("spouseOf", () => {
    expect(spouseOf("client")).toBe("spouse");
    expect(spouseOf("spouse")).toBe("client");
  });
});

describe("isSlat / labels / kind", () => {
  const ent = (o: Partial<EntitySummary>) => o as EntitySummary;
  it("isSlat", () => {
    const inc = [{ householdRole: "spouse" as const, percentage: 100 }];
    expect(isSlat({ trustSubType: "irrevocable", grantor: "client", incomeBeneficiaries: inc })).toBe(true);
    expect(isSlat({ trustSubType: "irrevocable", grantor: "spouse", incomeBeneficiaries: inc })).toBe(false);
    expect(isSlat({ trustSubType: "irrevocable", incomeBeneficiaries: inc })).toBe(false);
    expect(isSlat({ trustSubType: "ilit", grantor: "client", incomeBeneficiaries: inc })).toBe(false);
    expect(isSlat({ trustSubType: "irrevocable", grantor: "client" })).toBe(false);
  });
  it("trustTypeLabel / guidedKindOf", () => {
    const slat = ent({ trustSubType: "irrevocable", grantor: "client", incomeBeneficiaries: [{ householdRole: "spouse" as const, percentage: 100 }] });
    expect(trustTypeLabel(slat)).toBe("SLAT");
    expect(guidedKindOf(slat)).toBe("slat");
    const irr = ent({ trustSubType: "irrevocable" });
    expect(trustTypeLabel(irr)).toBe("Irrevocable");
    expect(guidedKindOf(irr)).toBe("irrevocable");
    for (const k of ["ilit", "idgt", "crt", "clt"] as const) {
      expect(trustTypeLabel(ent({ trustSubType: k }))).toBe(k.toUpperCase());
      expect(guidedKindOf(ent({ trustSubType: k }))).toBe(k);
    }
    expect(trustTypeLabel(ent({}))).toBe("Trust");
  });
});

describe("defaultTrustName", () => {
  const t = tree();
  it("by kind", () => {
    expect(defaultTrustName(base({ kind: "revocable" }), t)).toBe("Smith Family Revocable Trust");
    expect(defaultTrustName(base({ kind: "crt" }), t)).toBe("Charitable Remainder Trust");
    expect(defaultTrustName(base({ kind: "clt" }), t)).toBe("Charitable Lead Trust");
    expect(defaultTrustName(base({ kind: "irrevocable" }), t)).toBe("Smith Irrevocable Trust");
    expect(defaultTrustName(base({ kind: "slat" }), t)).toBe("Smith SLAT");
    expect(defaultTrustName(base({ kind: "ilit" }), t)).toBe("Smith ILIT");
    expect(defaultTrustName(base({ kind: "idgt" }), t)).toBe("Smith IDGT");
  });
  it("one remainder person names the trust", () => {
    expect(defaultTrustName(base({ kind: "ilit", remainder: [kid] }), t)).toBe("Kid Smith Irrevocable Trust");
    const t2 = tree({
      familyMembers: [{ id: "fm-1", role: "child", relationship: "child", firstName: "Kid", lastName: "Jones" }] as unknown as ClientData["familyMembers"],
    });
    expect(defaultTrustName(base({ remainder: [kid] }), t2)).toBe("Kid Jones Irrevocable Trust");
  });
  it("adds a number when another trust in the tree has the name", () => {
    const named = (...names: string[]) =>
      tree({ entities: names.map((name, i) => ({ id: `t${i}`, name })) as unknown as ClientData["entities"] });
    expect(defaultTrustName(base({ remainder: [kid] }), named("Kid Smith Irrevocable Trust"))).toBe(
      "Kid Smith Irrevocable Trust 2",
    );
    expect(
      defaultTrustName(base({ remainder: [kid] }), named(" kid smith irrevocable trust ", "Kid Smith Irrevocable Trust 2")),
    ).toBe("Kid Smith Irrevocable Trust 3");
    expect(defaultTrustName(base({ kind: "crt" }), named("Charitable Remainder Trust"))).toBe(
      "Charitable Remainder Trust 2",
    );
    const tagged = tree({
      accounts: [{ id: "a1", revocableTrustName: "Smith Family Revocable Trust" }] as unknown as ClientData["accounts"],
    });
    expect(defaultTrustName(base({ kind: "revocable" }), tagged)).toBe("Smith Family Revocable Trust 2");
  });
  it("two remainder people fall back to the kind name", () => {
    const two = [{ ...kid, percentage: 50 }, share("spouse", 50)];
    expect(defaultTrustName(base({ kind: "ilit", remainder: two }), t)).toBe("Smith ILIT");
  });
});

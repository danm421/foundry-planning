import { describe, it, expect, vi } from "vitest";
import { saveInsuranceRows, isEmptyInsurance, type InsuranceRow } from "../insurance-save";
import type { QsContext } from "../derive";

const ctx = {
  milestones: {} as QsContext["milestones"],
  planStartYear: 2026,
  planEndYear: 2066,
  clientFirstName: "John",
  spouseFirstName: "Jane",
  hasSpouse: true,
} as QsContext;

function deps() {
  let n = 0;
  return {
    ctx,
    familyMemberIdFor: vi.fn((insured: "client" | "spouse") =>
      insured === "spouse" ? "fm-spouse" : "fm-client",
    ),
    post: vi.fn(async () => ({ id: `srv-${++n}` })),
    patch: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  };
}

describe("isEmptyInsurance", () => {
  it("faceValue 0 is empty; faceValue 500000 is not", () => {
    expect(
      isEmptyInsurance({ insured: "client", policyType: "term", faceValue: 0, premiumAmount: 0 }),
    ).toBe(true);
    expect(
      isEmptyInsurance({
        insured: "client",
        policyType: "term",
        faceValue: 500000,
        premiumAmount: 0,
      }),
    ).toBe(false);
  });
});

describe("saveInsuranceRows", () => {
  it("POSTs a new non-empty row and assigns its serverId", async () => {
    const d = deps();
    const rows: InsuranceRow[] = [
      { _id: 1, insured: "client", policyType: "term", faceValue: 500000, premiumAmount: 1200 },
    ];
    const out = await saveInsuranceRows(rows, [], d);
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(out.rows[0].serverId).toBe("srv-1");
  });

  it("skips empty rows (faceValue 0, no write, row kept)", async () => {
    const d = deps();
    const out = await saveInsuranceRows(
      [{ _id: 1, insured: "client", policyType: "term", faceValue: 0, premiumAmount: 0 }],
      [],
      d,
    );
    expect(d.post).not.toHaveBeenCalled();
    expect(out.rows[0].serverId).toBeUndefined();
  });

  it("PATCHes a row that already has a serverId instead of POSTing", async () => {
    const d = deps();
    const rows: InsuranceRow[] = [
      {
        _id: 1,
        serverId: "x",
        insured: "client",
        policyType: "whole",
        faceValue: 250000,
        premiumAmount: 3000,
      },
    ];
    await saveInsuranceRows(rows, [], d);
    expect(d.patch).toHaveBeenCalledWith("x", expect.anything());
    expect(d.post).not.toHaveBeenCalled();
  });

  it("DELETEs ids in the deleted set", async () => {
    const d = deps();
    await saveInsuranceRows([], ["gone"], d);
    expect(d.del).toHaveBeenCalledWith("gone");
  });

  it("is idempotent: second save POSTs nothing, PATCHes once", async () => {
    const d = deps();
    const first = await saveInsuranceRows(
      [
        {
          _id: 1,
          insured: "client",
          policyType: "whole",
          faceValue: 500000,
          premiumAmount: 2000,
        },
      ],
      [],
      d,
    );
    d.post.mockClear();
    await saveInsuranceRows(first.rows, [], d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.patch).toHaveBeenCalledTimes(1);
  });

  it("threads the insured's family-member id into the payload (spouse row)", async () => {
    const d = deps();
    await saveInsuranceRows(
      [
        {
          _id: 1,
          insured: "spouse",
          policyType: "term",
          faceValue: 300000,
          premiumAmount: 800,
          termLengthYears: 20,
        },
      ],
      [],
      d,
    );
    expect(d.post).toHaveBeenCalledWith(
      expect.objectContaining({ ownerRef: { kind: "family", id: "fm-spouse" } }),
    );
  });
});

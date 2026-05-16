import { describe, it, expect } from "vitest";
import {
  willCreateSchema,
  willUpdateSchema,
  willBequestSchema,
} from "../wills";

const u = (suffix: string) =>
  `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;

const spouseRecipient = {
  recipientKind: "spouse" as const,
  recipientId: null,
  percentage: 100,
  sortOrder: 0,
};

const validBequest = {
  kind: "asset" as const,
  name: "Brokerage to spouse",
  assetMode: "specific" as const,
  accountId: u("1"),
  percentage: 100,
  condition: "always" as const,
  sortOrder: 0,
  recipients: [spouseRecipient],
};

const validLiabilityBequest = {
  kind: "liability" as const,
  name: "Visa CC",
  liabilityId: "11111111-1111-1111-1111-111111111111",
  condition: "always" as const,
  sortOrder: 0,
  recipients: [
    {
      recipientKind: "family_member" as const,
      recipientId: "22222222-2222-2222-2222-222222222222",
      percentage: 100,
      sortOrder: 0,
    },
  ],
};

describe("willBequestSchema", () => {
  it("accepts a well-formed specific bequest to spouse", () => {
    expect(willBequestSchema.safeParse(validBequest).success).toBe(true);
  });

  it("rejects specific bequest with null accountId", () => {
    const r = willBequestSchema.safeParse({ ...validBequest, accountId: null });
    expect(r.success).toBe(false);
  });

  it("rejects all_assets bequest with non-null accountId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      assetMode: "all_assets",
      accountId: u("1"),
    });
    expect(r.success).toBe(false);
  });

  it("accepts all_assets bequest with null accountId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      assetMode: "all_assets",
      accountId: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects recipient with recipientKind='spouse' AND non-null recipientId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [{ ...spouseRecipient, recipientId: u("2") }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects recipient with recipientKind='family_member' AND null recipientId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: null,
          percentage: 100,
          sortOrder: 0,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects when recipient percentages do not sum to 100", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: u("2"),
          percentage: 40,
          sortOrder: 0,
        },
        {
          recipientKind: "family_member" as const,
          recipientId: u("3"),
          percentage: 40,
          sortOrder: 1,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts multi-recipient split summing to 100", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: u("2"),
          percentage: 60,
          sortOrder: 0,
        },
        {
          recipientKind: "family_member" as const,
          recipientId: u("3"),
          percentage: 40,
          sortOrder: 1,
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("willCreateSchema", () => {
  it("accepts grantor='client' with empty bequests", () => {
    expect(
      willCreateSchema.safeParse({ grantor: "client", bequests: [] }).success,
    ).toBe(true);
  });

  it("rejects grantor='joint'", () => {
    expect(
      willCreateSchema.safeParse({ grantor: "joint", bequests: [] }).success,
    ).toBe(false);
  });

  it("defaults bequests to empty array", () => {
    const r = willCreateSchema.safeParse({ grantor: "client" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bequests).toEqual([]);
  });
});

describe("willUpdateSchema", () => {
  it("accepts a full replace payload", () => {
    expect(
      willUpdateSchema.safeParse({ bequests: [validBequest] }).success,
    ).toBe(true);
  });

  it("propagates bequest-level validation errors (specific with null accountId)", () => {
    const r = willUpdateSchema.safeParse({
      bequests: [{ ...validBequest, accountId: null }],
    });
    expect(r.success).toBe(false);
  });
});

describe("will bequest — liability kind", () => {
  it("accepts a well-formed liability bequest", () => {
    const input = { ...validLiabilityBequest };
    expect(willBequestSchema.parse(input)).toMatchObject({ kind: "liability" });
  });

  it("rejects external_beneficiary recipient on a liability bequest", () => {
    const input = {
      ...validLiabilityBequest,
      recipients: [
        {
          recipientKind: "external_beneficiary" as const,
          recipientId: "33333333-3333-3333-3333-333333333333",
          percentage: 100,
          sortOrder: 0,
        },
      ],
    };
    expect(() => willBequestSchema.parse(input)).toThrow(/recipient kind must be one of/);
  });

  it("rejects condition other than 'always' on a liability bequest", () => {
    const input = { ...validLiabilityBequest, condition: "if_spouse_survives" };
    expect(() => willBequestSchema.parse(input)).toThrow();
  });

  it("accepts partial recipient sum (0 < Σ ≤ 100)", () => {
    const input = {
      ...validLiabilityBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: "22222222-2222-2222-2222-222222222222",
          percentage: 60,
          sortOrder: 0,
        },
      ],
    };
    expect(willBequestSchema.parse(input)).toMatchObject({ kind: "liability" });
  });

  it("rejects Σ > 100", () => {
    const input = {
      ...validLiabilityBequest,
      recipients: [
        { recipientKind: "family_member" as const, recipientId: "22222222-2222-2222-2222-222222222222", percentage: 80, sortOrder: 0 },
        { recipientKind: "family_member" as const, recipientId: "44444444-4444-4444-4444-444444444444", percentage: 80, sortOrder: 1 },
      ],
    };
    expect(() => willBequestSchema.parse(input)).toThrow(/0 < sum ≤ 100/);
  });

  it("rejects liability payload carrying accountId (cross-branch contamination)", () => {
    const input = {
      ...validLiabilityBequest,
      accountId: "99999999-9999-9999-9999-999999999999",
    };
    expect(() => willBequestSchema.parse(input)).toThrow();
  });

  it("rejects asset payload carrying liabilityId (cross-branch contamination)", () => {
    const input = {
      ...validBequest,
      liabilityId: "44444444-4444-4444-4444-444444444444",
    };
    expect(() => willBequestSchema.parse(input)).toThrow();
  });
});

describe("willCreateSchema with residuary", () => {
  const baseValidWill = {
    grantor: "client" as const,
    bequests: [],
  };

  it("accepts a will with no residuary field", () => {
    const result = willCreateSchema.safeParse(baseValidWill);
    expect(result.success).toBe(true);
  });

  it("accepts a will with empty residuary array", () => {
    const result = willCreateSchema.safeParse({
      ...baseValidWill,
      residuaryRecipients: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts residuary with one 100% recipient", () => {
    const result = willCreateSchema.safeParse({
      ...baseValidWill,
      residuaryRecipients: [
        {
          recipientKind: "family_member",
          recipientId: u("a"),
          percentage: 100,
          sortOrder: 0,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts residuary that sums to 100 across multiple recipients", () => {
    const result = willCreateSchema.safeParse({
      ...baseValidWill,
      residuaryRecipients: [
        {
          recipientKind: "spouse",
          recipientId: null,
          percentage: 50,
          sortOrder: 0,
        },
        {
          recipientKind: "family_member",
          recipientId: u("a"),
          percentage: 50,
          sortOrder: 1,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects residuary that does not sum to 100", () => {
    const result = willCreateSchema.safeParse({
      ...baseValidWill,
      residuaryRecipients: [
        {
          recipientKind: "spouse",
          recipientId: null,
          percentage: 60,
          sortOrder: 0,
        },
        {
          recipientKind: "family_member",
          recipientId: u("a"),
          percentage: 30,
          sortOrder: 1,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects residuary recipient with spouse kind + non-null id", () => {
    const result = willCreateSchema.safeParse({
      ...baseValidWill,
      residuaryRecipients: [
        {
          recipientKind: "spouse",
          recipientId: u("a"),
          percentage: 100,
          sortOrder: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects residuary with non-spouse kind + null id", () => {
    const result = willCreateSchema.safeParse({
      ...baseValidWill,
      residuaryRecipients: [
        {
          recipientKind: "family_member",
          recipientId: null,
          percentage: 100,
          sortOrder: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("willUpdateSchema with residuary", () => {
  it("accepts an update with empty residuary", () => {
    const result = willUpdateSchema.safeParse({
      bequests: [],
      residuaryRecipients: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("residuary tier validation", () => {
  const recip = (
    tier: "primary" | "contingent",
    percentage: number,
    sortOrder: number,
  ) => ({
    recipientKind: "family_member" as const,
    recipientId: "11111111-1111-1111-1111-111111111111",
    tier,
    percentage,
    sortOrder,
  });

  it("defaults a tier-less recipient to 'primary'", () => {
    const parsed = willUpdateSchema.parse({
      bequests: [],
      residuaryRecipients: [
        {
          recipientKind: "family_member",
          recipientId: "11111111-1111-1111-1111-111111111111",
          percentage: 100,
          sortOrder: 0,
        },
      ],
    });
    expect(parsed.residuaryRecipients?.[0].tier).toBe("primary");
  });

  it("accepts each tier summing to 100 independently", () => {
    const r = willUpdateSchema.safeParse({
      bequests: [],
      residuaryRecipients: [
        recip("primary", 100, 0),
        recip("contingent", 60, 1),
        recip("contingent", 40, 2),
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a primary tier that does not sum to 100", () => {
    const r = willUpdateSchema.safeParse({
      bequests: [],
      residuaryRecipients: [recip("primary", 80, 0)],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-empty contingent tier that does not sum to 100", () => {
    const r = willUpdateSchema.safeParse({
      bequests: [],
      residuaryRecipients: [recip("primary", 100, 0), recip("contingent", 50, 1)],
    });
    expect(r.success).toBe(false);
  });
});

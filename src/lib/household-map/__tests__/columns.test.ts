import { describe, it, expect } from "vitest";
import { assignColumn } from "../columns";
import type { ColumnContext } from "../types";
import { EDUCATION_529_SENTINEL_OWNER_ID } from "@/engine/ownership";

const CLIENT_FM = "fm-client";
const SPOUSE_FM = "fm-spouse";
const CHILD_FM = "fm-child";

const ctx: ColumnContext = {
  roleByFamilyMemberId: new Map([
    [CLIENT_FM, "client"],
    [SPOUSE_FM, "spouse"],
    [CHILD_FM, "child"],
  ] as const),
  nameByFamilyMemberId: new Map([
    [CLIENT_FM, "Dan"],
    [SPOUSE_FM, "Amy"],
    [CHILD_FM, "Kelly"],
  ]),
  nameByEntityId: new Map([["ent-1", "Sample Family Trust"]]),
};

const fm = (familyMemberId: string, percent: number) =>
  ({ kind: "family_member", familyMemberId, percent }) as const;

describe("assignColumn", () => {
  it("puts a 100% client-owned item in the client column", () => {
    const r = assignColumn({ owners: [fm(CLIENT_FM, 1)] }, ctx);
    expect(r.column).toBe("client");
    expect(r.splitChip).toBeNull();
  });

  it("puts a 100% spouse-owned item in the spouse column", () => {
    expect(assignColumn({ owners: [fm(SPOUSE_FM, 1)] }, ctx).column).toBe("spouse");
  });

  it("puts a 50/50 item in joint with no chip", () => {
    const r = assignColumn({ owners: [fm(CLIENT_FM, 0.5), fm(SPOUSE_FM, 0.5)] }, ctx);
    expect(r.column).toBe("joint");
    expect(r.splitChip).toBeNull();
  });

  it("puts a 60/40 item in joint with a client-first chip", () => {
    const r = assignColumn({ owners: [fm(CLIENT_FM, 0.6), fm(SPOUSE_FM, 0.4)] }, ctx);
    expect(r.column).toBe("joint");
    expect(r.splitChip).toBe("60/40");
  });

  it("orders the chip client-first regardless of owner array order", () => {
    const r = assignColumn({ owners: [fm(SPOUSE_FM, 0.7), fm(CLIENT_FM, 0.3)] }, ctx);
    expect(r.splitChip).toBe("30/70");
  });

  // Rounding each side independently turns 50.5/49.5 into "51/50" — a chip
  // that sums to 101. The second side is derived from the first instead.
  it("keeps the chip's two halves summing to 100 when both sides round up", () => {
    const r = assignColumn({ owners: [fm(CLIENT_FM, 0.505), fm(SPOUSE_FM, 0.495)] }, ctx);
    expect(r.splitChip).toBe("51/49");
  });

  it("sends an entity-owned item to the tray with the entity name", () => {
    const r = assignColumn(
      { owners: [{ kind: "entity", entityId: "ent-1", percent: 1 }] },
      ctx,
    );
    expect(r.column).toBe("tray");
    expect(r.trayOwnerLabel).toBe("Sample Family Trust");
  });

  it("sends a child-owned item to the tray with the child name", () => {
    const r = assignColumn({ owners: [fm(CHILD_FM, 1)] }, ctx);
    expect(r.column).toBe("tray");
    expect(r.trayOwnerLabel).toBe("Kelly");
  });

  it("sends a mixed household/entity item to the tray", () => {
    const r = assignColumn(
      {
        owners: [
          fm(CLIENT_FM, 0.5),
          { kind: "entity", entityId: "ent-1", percent: 0.5 },
        ],
      },
      ctx,
    );
    expect(r.column).toBe("tray");
  });

  it("sends an external-beneficiary-owned item to the tray", () => {
    const r = assignColumn(
      {
        owners: [
          { kind: "external_beneficiary", externalBeneficiaryId: "eb-1", percent: 1 },
        ],
      },
      ctx,
    );
    expect(r.column).toBe("tray");
  });

  it("treats a 529 sentinel owner as household-invisible and trays it", () => {
    const r = assignColumn(
      {
        owners: [
          {
            kind: "external_beneficiary",
            externalBeneficiaryId: EDUCATION_529_SENTINEL_OWNER_ID,
            percent: 1,
          },
        ],
      },
      ctx,
    );
    expect(r.column).toBe("tray");
  });

  it("trays an ownerless item with an explicit label", () => {
    const r = assignColumn({ owners: [] }, ctx);
    expect(r.column).toBe("tray");
    expect(r.trayOwnerLabel).toBe("No owner set");
  });

  it("trays an unknown family member id rather than guessing a column", () => {
    const r = assignColumn({ owners: [fm("fm-ghost", 1)] }, ctx);
    expect(r.column).toBe("tray");
    expect(r.trayOwnerLabel).toBe("No owner set");
  });
});

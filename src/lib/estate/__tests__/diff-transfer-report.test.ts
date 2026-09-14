import { describe, it, expect } from "vitest";
import { diffTransferReport } from "@/lib/estate/diff-transfer-report";
import type {
  DeathSectionData,
  EstateTransferReportData,
  RecipientGroup,
  RecipientTotal,
} from "@/lib/estate/transfer-report";

function recipient(key: string, total: number): RecipientGroup {
  return { key, recipientLabel: key, total } as RecipientGroup;
}

function total(key: string, t: number): RecipientTotal {
  return { key, recipientLabel: key, total: t } as RecipientTotal;
}

function section(over: Partial<DeathSectionData> = {}): DeathSectionData {
  return {
    assetEstateValue: 0,
    taxableEstate: 0,
    grossEstate: 0,
    recipients: [],
    // Required on the type and read by the diff — the header's "Estate at
    // death" nets debt assumed onto the asset leg. Omitting it made every
    // fixture here a lie the cast hid.
    reconciliation: {
      sumLiabilityTransfers: 0,
      sumRecipients: 0,
      sumReductions: 0,
      unattributed: 0,
      reconciles: true,
    },
    ...over,
  } as DeathSectionData;
}

function report(over: Partial<EstateTransferReportData> = {}): EstateTransferReportData {
  return {
    firstDeath: null,
    secondDeath: null,
    aggregateRecipientTotals: [],
    isEmpty: false,
    ...over,
  } as EstateTransferReportData;
}

describe("diffTransferReport", () => {
  it("returns null for a death section neither side has", () => {
    const d = diffTransferReport(report(), report());
    expect(d.firstDeath).toBeNull();
    expect(d.secondDeath).toBeNull();
  });

  it("diffs death-section subtotals as right minus left", () => {
    const d = diffTransferReport(
      report({ firstDeath: section({ assetEstateValue: 8_000_000, taxableEstate: 7_000_000 }) }),
      report({ firstDeath: section({ assetEstateValue: 6_000_000, taxableEstate: 5_000_000 }) }),
    );
    expect(d.firstDeath?.assetEstateValue).toBe(-2_000_000);
    expect(d.firstDeath?.taxableEstate).toBe(-2_000_000);
  });

  // The header's "Estate at death" is assets PLUS the debt assumed, so it is
  // its own quantity — the two diverge whenever a scenario changes the debt
  // riding through the death event, and only one of them belongs beside the
  // headline figure.
  it("diffs the header's estate-at-death separately from the asset leg", () => {
    const d = diffTransferReport(
      report({
        firstDeath: section({
          assetEstateValue: 5_000_000,
          reconciliation: {
            sumLiabilityTransfers: -1_000_000,
            sumRecipients: 4_000_000,
            sumReductions: 0,
            unattributed: 0,
            reconciles: true,
          },
        }),
      }),
      report({
        firstDeath: section({
          assetEstateValue: 6_200_000,
          reconciliation: {
            sumLiabilityTransfers: -3_000_000,
            sumRecipients: 3_200_000,
            sumReductions: 0,
            unattributed: 0,
            reconciles: true,
          },
        }),
      }),
    );
    // Assets rose $1.2M; the header fell $800K. Opposite signs, same fixture.
    expect(d.firstDeath?.assetEstateValue).toBe(1_200_000);
    expect(d.firstDeath?.estateAtDeath).toBe(-800_000);
  });

  it("treats a section the right side gained as a diff against zero", () => {
    const d = diffTransferReport(
      report(),
      report({ secondDeath: section({ assetEstateValue: 4_000_000 }) }),
    );
    expect(d.secondDeath?.assetEstateValue).toBe(4_000_000);
  });

  it("marks a recipient only the right side has as added", () => {
    const d = diffTransferReport(
      report({ firstDeath: section({ recipients: [] }) }),
      report({ firstDeath: section({ recipients: [recipient("trust|t1", 1_900_000)] }) }),
    );
    expect(d.firstDeath?.recipients.get("trust|t1")).toEqual({
      key: "trust|t1",
      status: "added",
      delta: 1_900_000,
    });
  });

  it("marks a recipient only the left side has as removed", () => {
    const d = diffTransferReport(
      report({ firstDeath: section({ recipients: [recipient("charity|c1", 500_000)] }) }),
      report({ firstDeath: section({ recipients: [] }) }),
    );
    expect(d.firstDeath?.recipients.get("charity|c1")).toEqual({
      key: "charity|c1",
      status: "removed",
      delta: -500_000,
    });
  });

  it("diffs the aggregate recipient totals by their existing key", () => {
    const d = diffTransferReport(
      report({ aggregateRecipientTotals: [total("heir|h1", 3_000_000)] }),
      report({ aggregateRecipientTotals: [total("heir|h1", 4_200_000)] }),
    );
    expect(d.aggregateRecipientTotals.get("heir|h1")).toEqual({
      key: "heir|h1",
      status: "changed",
      delta: 1_200_000,
    });
  });

  it("marks an unchanged recipient total as same", () => {
    const d = diffTransferReport(
      report({ aggregateRecipientTotals: [total("heir|h1", 3_000_000)] }),
      report({ aggregateRecipientTotals: [total("heir|h1", 3_000_000)] }),
    );
    expect(d.aggregateRecipientTotals.get("heir|h1")?.status).toBe("same");
  });
});

import type {
  AssetTransferLine,
  DeathSectionData,
  EstateTransferReportData,
  RecipientGroup,
  ReductionsLine,
} from "@/lib/estate/transfer-report";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

export interface EstateFlowSummary {
  spouseNetWorth: { ownerLabel: string; amount: number } | null;
  firstDeath: DeathStage | null;
  secondDeath: DeathStage | null;
  outOfEstate: {
    heirs: { total: number; entities: OoeEntity[] };
    irrevTrusts: { total: number; entities: OoeEntity[] };
  };
  heirBoxes: HeirBox[];
  totals: { totalTaxesAndExpenses: number; totalToHeirs: number };
}

export interface DeathStage {
  decedentLabel: string;
  year: number;
  estateValue: number;
  estateLines: AssetTransferLine[];
  subBoxes: DeathSubBox[];
}

export type DeathSubBoxKind =
  | "taxes"
  | "trusts"
  | "inheritance_spouse"
  | "heirs_outright";

export interface DeathSubBox {
  kind: DeathSubBoxKind;
  label: string;
  total: number;
  lines: ReductionsLine[] | AssetTransferLine[];
  targetLabel?: string;
}

export interface HeirBox {
  recipientKey: string;
  recipientLabel: string;
  outright: number;
  inTrust: number;
  total: number;
  sections: HeirSection[];
}

export interface HeirSection {
  title: string;
  lines: { label: string; amount: number }[];
  subtotal?: number;
}

export interface OoeEntity {
  entityId: string;
  entityLabel: string;
  amount: number;
  assets: { label: string; amount: number }[];
}

export interface BuildEstateFlowSummaryInput {
  reportData: EstateTransferReportData;
  clientData: ClientData;
  gifts: EstateFlowGift[];
  ownerNames: { clientName: string; spouseName: string | null };
}

// Friendly labels for ReductionsLine kinds, used inside the death-stage taxes box.
const fmtKindLabels: Record<ReductionsLine["kind"], string> = {
  federal_estate_tax: "Federal Estate Tax",
  state_estate_tax: "State Estate Tax",
  admin_expenses: "Admin Expenses",
  debts_paid: "Debts Paid",
  ird_tax: "IRD Tax",
};

// Outright-heir recipient kinds — everything that ends up in the household's
// "to heirs" buckets at the end of the flow (i.e. not the spouse continuing
// the household and not a trust entity).
const OUTRIGHT_HEIR_KINDS: ReadonlySet<RecipientGroup["recipientKind"]> = new Set([
  "family_member",
  "external_beneficiary",
  "system_default",
]);

function buildDeathStage(
  section: DeathSectionData,
  spouseLabel: string | null,
  isFirstDeath: boolean,
): DeathStage {
  // Flatten estate-source lines from the section's recipients.
  const estateLines: AssetTransferLine[] = section.recipients.flatMap((r) =>
    r.byMechanism.flatMap((m) => m.assets),
  );

  const subBoxes: DeathSubBox[] = [];

  // taxes — only when there are reductions (federal/state estate, admin, debts, IRD).
  if (section.reductions.length > 0) {
    const taxLines: ReductionsLine[] = section.reductions.map((r) => ({
      kind: r.kind,
      label: fmtKindLabels[r.kind] ?? r.label,
      amount: r.amount,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }));
    subBoxes.push({
      kind: "taxes",
      label: "Taxes & Expenses",
      total: taxLines.reduce((s, l) => s + l.amount, 0),
      lines: taxLines,
    });
  }

  // trusts — recipientKind === "entity" (the engine's bucket for trust recipients).
  const trustGroups = section.recipients.filter((g) => g.recipientKind === "entity");
  if (trustGroups.length > 0) {
    const trustAssets: AssetTransferLine[] = trustGroups.flatMap((g) =>
      g.byMechanism.flatMap((m) => m.assets),
    );
    subBoxes.push({
      kind: "trusts",
      label: "Trusts",
      total: trustGroups.reduce((s, g) => s + g.total, 0),
      lines: trustAssets,
    });
  }

  // inheritance_spouse — only at first death, only if a spouse group exists.
  if (isFirstDeath) {
    const spouseGroup = section.recipients.find(
      (g) => g.recipientKind === "spouse" && g.total > 0,
    );
    if (spouseGroup) {
      const spouseAssets: AssetTransferLine[] = spouseGroup.byMechanism.flatMap(
        (m) => m.assets,
      );
      subBoxes.push({
        kind: "inheritance_spouse",
        label: "Surviving Spouse",
        total: spouseGroup.total,
        lines: spouseAssets,
        targetLabel: spouseLabel ? `${spouseLabel}'s Estate` : "Surviving Spouse",
      });
    }
  }

  // heirs_outright — family_member | external_beneficiary | system_default groups.
  const outrightGroups = section.recipients.filter((g) =>
    OUTRIGHT_HEIR_KINDS.has(g.recipientKind),
  );
  if (outrightGroups.length > 0) {
    const outrightAssets: AssetTransferLine[] = outrightGroups.flatMap((g) =>
      g.byMechanism.flatMap((m) => m.assets),
    );
    subBoxes.push({
      kind: "heirs_outright",
      label: "Heirs",
      total: outrightGroups.reduce((s, g) => s + g.total, 0),
      lines: outrightAssets,
    });
  }

  return {
    decedentLabel: `${section.decedentName}'s Estate`,
    year: section.year,
    estateValue: section.assetEstateValue,
    estateLines,
    subBoxes,
  };
}

export function buildEstateFlowSummary(
  input: BuildEstateFlowSummaryInput,
): EstateFlowSummary | null {
  const { reportData, ownerNames } = input;
  if (reportData.isEmpty) return null;

  const firstDeath = reportData.firstDeath
    ? buildDeathStage(
        reportData.firstDeath,
        // The surviving spouse's label is the non-decedent owner.
        reportData.firstDeath.decedent === "client"
          ? ownerNames.spouseName
          : ownerNames.clientName,
        true,
      )
    : null;

  const secondDeath = reportData.secondDeath
    ? buildDeathStage(
        reportData.secondDeath,
        reportData.secondDeath.decedent === "client"
          ? ownerNames.spouseName
          : ownerNames.clientName,
        false,
      )
    : null;

  return {
    spouseNetWorth: null,
    firstDeath,
    secondDeath,
    outOfEstate: {
      heirs: { total: 0, entities: [] },
      irrevTrusts: { total: 0, entities: [] },
    },
    heirBoxes: [],
    totals: { totalTaxesAndExpenses: 0, totalToHeirs: 0 },
  };
}

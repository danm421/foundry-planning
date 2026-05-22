import type {
  AssetTransferLine,
  EstateTransferReportData,
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

export function buildEstateFlowSummary(
  _input: BuildEstateFlowSummaryInput,
): EstateFlowSummary | null {
  throw new Error("not implemented");
}

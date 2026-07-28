// src/lib/household-map/types.ts
import type { MapGoal } from "./goals";

/** Which column of a Household Map board an item belongs in. `tray` is the
 *  bottom strip for anything not owned by the client or spouse. */
export type MapColumn = "client" | "joint" | "spouse" | "tray";

/** Lookup data `assignColumn` needs to resolve ids to roles and labels. */
export interface ColumnContext {
  /** family_member id → household role. */
  roleByFamilyMemberId: ReadonlyMap<string, "client" | "spouse" | "child" | "other">;
  /** family_member id → display name, for tray labels. */
  nameByFamilyMemberId: ReadonlyMap<string, string>;
  /** entity id → display name, for tray labels. */
  nameByEntityId: ReadonlyMap<string, string>;
}

export interface ColumnAssignment {
  column: MapColumn;
  /** e.g. "60/40". Null when the split is 50/50 or the item isn't joint. */
  splitChip: string | null;
  /** Owner label shown on a tray card. Null for non-tray columns. */
  trayOwnerLabel: string | null;
}

/** A household member drawn as a node at the top of a board column. */
export interface MapPerson {
  familyMemberId: string | null;
  firstName: string;
  age: number | null;
  retirementYear: number | null;
}

/** One card on a board. Assembled server-side by the map route's adapters. */
export interface MapItem {
  id: string;
  kind: "account" | "liability" | "policy" | "income" | "savings" | "expense";
  category: "investments" | "property" | "debt" | "insurance" | "entity";
  name: string;
  /** Pre-formatted for display, e.g. "$160,000" or "($10,000)". */
  valueLabel: string;
  /** Signed, for subtotals. Liabilities are negative. */
  value: number;
  column: MapColumn;
  splitChip: string | null;
  trayOwnerLabel: string | null;
  /** Extra chip, e.g. "for Kelly" or "8% + 4% match". */
  noteChip: string | null;
}

/** The single prop object every Household Map board reads. */
export interface HouseholdMapProps {
  clientId: string;
  people: { client: MapPerson; spouse: MapPerson | null; children: MapPerson[] };
  netWorthLabel: string;
  items: MapItem[];
  goals: MapGoal[];
  canEdit: boolean;
}

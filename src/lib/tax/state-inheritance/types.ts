import type { Bracket, BracketLine } from "@/lib/tax/state-estate/types";

/** Re-export Phase 1's Bracket type — same shape. */
export type { Bracket, BracketLine };

export type StateInheritanceCode = "PA" | "NJ" | "KY" | "NE" | "MD";

export type InheritanceRelationship =
  | "child"
  | "stepchild"
  | "grandchild"
  | "great_grandchild"
  | "parent"
  | "grandparent"
  | "sibling"
  | "sibling_in_law"
  | "child_in_law"
  | "niece_nephew"
  | "aunt_uncle"
  | "cousin"
  | "grand_aunt_uncle"
  | "other";

/** PA Class A is "spouse + minor child only". A=top; D=bottom. */
export type PAClass = "A" | "B" | "C" | "D";
export type NJClass = "A" | "C" | "D";
export type KYClass = "A" | "B" | "C";
export type NEClass = "B" | "C" | "D";
export type MDClass = "A" | "B";
export type InheritanceClassLetter = "A" | "B" | "C" | "D";

export interface InheritanceClassRule {
  exemption: number;
  brackets: Bracket[];
  /** NJ Class D: bequests below this threshold owe no tax. */
  deMinimis?: number;
}

export interface StateInheritanceTaxRule {
  state: StateInheritanceCode;
  effectiveYear: number;
  classes: Record<string, InheritanceClassRule>;
  estateMinimum?: number;
  reducesStateEstateTax?: boolean;
  excludesAllLifeInsurance?: boolean;
  excludesIraIfDecedentUnder59Half?: boolean;
  beneficiaryAgeExemptUnder?: number;
  domesticPartnerResidenceExemption?: boolean;
  citation: string;
}

export type ClassSource =
  | "spouse-role"
  | "domestic-partner"
  | "derived-from-relationship"
  | "explicit-override"
  | "minor-child"
  | "charity"
  | "external-individual";

export interface InheritanceRecipientResult {
  recipientKey: string;
  label: string;
  classLabel: string;
  classSource: ClassSource;
  grossShare: number;
  excluded: number;
  excludedReasons: string[];
  exemption: number;
  taxableShare: number;
  bracketLines: BracketLine[];
  tax: number;
  netToRecipient: number;
  notes: string[];
}

export interface StateInheritanceTaxResult {
  state: StateInheritanceCode | null;
  inactive: boolean;
  estateMinimumFloorApplied: boolean;
  perRecipient: InheritanceRecipientResult[];
  totalTax: number;
  notes: string[];
}

export type ComponentKind = "life_insurance" | "ira" | "other";

export interface RecipientInput {
  key: string;
  label: string;
  grossShare: number;
  components: Array<{ kind: ComponentKind; amount: number }>;
  relationship: InheritanceRelationship | "spouse";
  isMinorChild: boolean;
  age: number | null;
  domesticPartner: boolean;
  isCharity: boolean;
  isExternalIndividual: boolean;
  classOverride?: InheritanceClassLetter;
  primaryResidenceJointlyHeldWithDomesticPartner: boolean;
}

export interface ComputeStateInheritanceTaxInput {
  state: StateInheritanceCode | null;
  deathYear: number;
  decedentAge: number;
  grossEstate: number;
  recipients: RecipientInput[];
}

import type {
  ClassSource,
  InheritanceClassLetter,
  InheritanceRelationship,
  RecipientInput,
  StateInheritanceCode,
} from "./types";

export interface DerivedClass {
  classLabel: InheritanceClassLetter | "exempt";
  classSource: ClassSource;
}

export function deriveInheritanceClass(
  state: StateInheritanceCode,
  r: RecipientInput,
): DerivedClass {
  if (r.classOverride !== undefined) {
    return { classLabel: r.classOverride, classSource: "explicit-override" };
  }
  if (r.isCharity) {
    return { classLabel: "exempt", classSource: "charity" };
  }
  const isSpouse =
    r.relationship === "spouse" || (r.domesticPartner && stateRecognizesDomPartner(state));
  if (isSpouse) {
    if (state === "NE") {
      return { classLabel: "exempt", classSource: r.domesticPartner ? "domestic-partner" : "spouse-role" };
    }
    return { classLabel: "A", classSource: r.domesticPartner ? "domestic-partner" : "spouse-role" };
  }
  // PA — minor-child carve-out
  if (state === "PA" && r.relationship === "child" && r.isMinorChild) {
    return { classLabel: "A", classSource: "minor-child" };
  }
  // External non-charity individual (no FamilyMember row) — always highest non-A class
  if (r.isExternalIndividual) {
    return { classLabel: highestClassFor(state), classSource: "external-individual" };
  }
  return { classLabel: classFromRelationship(state, r.relationship), classSource: "derived-from-relationship" };
}

function stateRecognizesDomPartner(state: StateInheritanceCode): boolean {
  return state === "NJ" || state === "MD";
}

function highestClassFor(state: StateInheritanceCode): InheritanceClassLetter {
  switch (state) {
    case "PA": return "D";
    case "NJ": return "D";
    case "KY": return "C";
    case "NE": return "D";
    case "MD": return "B";
  }
}

function classFromRelationship(
  state: StateInheritanceCode,
  rel: InheritanceRelationship | "spouse",
): InheritanceClassLetter {
  // Derived from spec §"Class derivation" table.
  if (state === "PA") {
    switch (rel) {
      case "child": case "stepchild": case "grandchild": case "great_grandchild":
      case "parent": case "grandparent":
        return "B";
      case "sibling": case "child_in_law":
        return "C";
      default:
        return "D";
    }
  }
  if (state === "NJ") {
    switch (rel) {
      case "child": case "stepchild": case "grandchild": case "great_grandchild":
      case "parent": case "grandparent":
        return "A";
      case "sibling": case "sibling_in_law":
        return "C";
      default:
        return "D";
    }
  }
  if (state === "KY") {
    switch (rel) {
      case "child": case "stepchild": case "grandchild":
      case "parent": case "sibling":
        return "A";
      case "great_grandchild": case "niece_nephew": case "aunt_uncle": case "child_in_law":
        return "B";
      default:
        return "C";
    }
  }
  if (state === "NE") {
    switch (rel) {
      case "child": case "stepchild": case "grandchild": case "great_grandchild":
      case "parent": case "grandparent": case "sibling": case "sibling_in_law":
      case "child_in_law":
        return "B";
      case "niece_nephew": case "aunt_uncle": case "cousin": case "grand_aunt_uncle":
        return "C";
      default:
        return "D";
    }
  }
  // MD
  switch (rel) {
    case "child": case "stepchild": case "grandchild": case "great_grandchild":
    case "parent": case "grandparent": case "sibling": case "child_in_law":
      return "A";
    default:
      return "B";
  }
}

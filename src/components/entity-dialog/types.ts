import type { Entity } from "../family-view";

export type EntityKind = "trust" | "business";
export type EntityDialogTab = "details" | "beneficiaries";

export function getEntityKind(entityType: Entity["entityType"]): EntityKind {
  return entityType === "trust" || entityType === "foundation" ? "trust" : "business";
}

export interface EntityFormCommonProps {
  clientId: string;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onClose: () => void;
  initialTab?: EntityDialogTab;
  /**
   * When true, restrict the dialog to the Beneficiaries tab: hide the Details
   * tab button and unmount its form. Used by the Beneficiary Summary deep-link
   * to prevent accidental overwrite of Details fields.
   * Business entities have no tabs and ignore this prop.
   */
  lockTab?: boolean;
}

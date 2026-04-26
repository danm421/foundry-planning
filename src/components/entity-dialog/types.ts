import type { Entity } from "../family-view";

export type EntityKind = "trust" | "business";

export function getEntityKind(entityType: Entity["entityType"]): EntityKind {
  return entityType === "trust" || entityType === "foundation" ? "trust" : "business";
}

export interface EntityFormCommonProps {
  clientId: string;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onClose: () => void;
}

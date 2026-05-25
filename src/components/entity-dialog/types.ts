import type { Entity } from "../family-view";

export type EntityKind = "trust";

export interface EntityFormCommonProps {
  clientId: string;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onClose: () => void;
}

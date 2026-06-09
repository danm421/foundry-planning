// src/components/presentations/pages/entity-cash-flow/types.ts
import type { SelectedRows } from "@/components/entities-cashflow-report/view-model";
import type { RangeOption } from "@/lib/presentations/shared/year-filter";

export interface EntityCashFlowPageOptions {
  /** Selected trust/business id. "" until the advisor picks one. */
  entityId: string;
  /** Denormalized name — drives the page title + options summary even if the
   *  entity later disappears from the projection. Written alongside entityId. */
  entityName: string;
  range: RangeOption;
}

export const ENTITY_CASH_FLOW_OPTIONS_DEFAULT: EntityCashFlowPageOptions = {
  entityId: "",
  entityName: "",
  range: "full",
};

export interface EntityCashFlowPageData {
  title: string;
  subtitle: string;
  selected: SelectedRows;
}

// src/domain/forge/detail-fields/index.ts
//
// The Details field map: every field an advisor can enter on the eight Details
// tabs, with the route and table behind it.
//
// Forge reads this to answer two questions before it writes anything extracted
// from a document:
//   1. "What can I actually fill in on this client?"  → DETAIL_ENTITIES
//   2. "Where does this particular value go?"         → findEntity / findField
//
// Scope is Details only. The intake flow, Quick Start, Estate Planning and the
// Solver write plan data too and are deliberately NOT covered here.
//
// `__tests__/detail-fields.test.ts` pins every table, route, schema, write core
// and tool name in this map against the real repo.
import type { DetailEntity, DetailField, DetailsTab } from "./types";
import { PROFILE_ENTITIES } from "./profile";
import { NET_WORTH_ACCOUNT_ENTITIES } from "./net-worth-accounts";
import { NET_WORTH_OTHER_ENTITIES } from "./net-worth-other";
import { INCOME_EXPENSE_ENTITIES } from "./income-expenses";
import { INSURANCE_ENTITIES } from "./insurance";
import { TECHNIQUE_OBSERVATION_ENTITIES } from "./techniques-observations";
import { WILLS_ENTITIES } from "./wills";
import { ASSUMPTIONS_ENTITIES } from "./assumptions";

export type { DetailEntity, DetailField, DetailsTab } from "./types";

/**
 * Tab id → its path segment under `/clients/[id]/details/`, so Forge can deep
 * link the advisor to the screen it just wrote to. Note "profile" lives at
 * `family` — the sidebar label was renamed, the route was not.
 */
export const TAB_ROUTES: Record<DetailsTab, string> = {
  profile: "family",
  observations: "observations",
  "net-worth": "net-worth",
  "income-expenses": "income-expenses",
  insurance: "insurance",
  techniques: "techniques",
  wills: "wills",
  assumptions: "assumptions",
};

export const DETAIL_ENTITIES: readonly DetailEntity[] = [
  ...PROFILE_ENTITIES,
  ...NET_WORTH_ACCOUNT_ENTITIES,
  ...NET_WORTH_OTHER_ENTITIES,
  ...INCOME_EXPENSE_ENTITIES,
  ...INSURANCE_ENTITIES,
  ...TECHNIQUE_OBSERVATION_ENTITIES,
  ...WILLS_ENTITIES,
  ...ASSUMPTIONS_ENTITIES,
];

export function entitiesForTab(tab: DetailsTab): DetailEntity[] {
  return DETAIL_ENTITIES.filter((e) => e.tab === tab);
}

export function findEntity(id: string): DetailEntity | undefined {
  return DETAIL_ENTITIES.find((e) => e.id === id);
}

export function findField(
  entityId: string,
  key: string,
): DetailField | undefined {
  return findEntity(entityId)?.fields.find((f) => f.key === key);
}

/** Entities Forge can already write, and the ones still needing a tool built. */
export function writableToday(): DetailEntity[] {
  return DETAIL_ENTITIES.filter((e) => e.forgeTool !== undefined);
}

export function missingForgeTool(): DetailEntity[] {
  return DETAIL_ENTITIES.filter((e) => e.forgeTool === undefined);
}

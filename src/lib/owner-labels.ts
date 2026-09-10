// Shared helpers for turning the client/spouse/joint owner enum into human-readable
// labels. The enum stays unchanged in the database so the projection engine and
// SQL queries don't need to know real names; these helpers only affect display.
//
// Display rule: prefer the person's real name. `CO_CLIENT_LABEL` is the fallback for
// when we don't have one — it is never a default. See the co-client terminology spec.

export interface OwnerNames {
  clientName: string;
  spouseName: string | null;
}

export type IndividualOwner = "client" | "spouse" | "joint";

/** The word shown for the second person when we have no name for them. */
export const CO_CLIENT_LABEL = "Co-client";

/** Label for one household member, preferring their real name. */
export function personLabel(person: "client" | "spouse", names: OwnerNames): string {
  return person === "client" ? names.clientName : (names.spouseName ?? CO_CLIENT_LABEL);
}

/** Ready-made options for the owner dropdowns, in household order. */
export function ownerOptions(names: OwnerNames): { value: IndividualOwner; label: string }[] {
  return (["client", "spouse", "joint"] as const).map((value) => ({
    value,
    label: individualOwnerLabel(value, names),
  }));
}

/** Label for an individual-owner enum, using real names when available. */
export function individualOwnerLabel(owner: IndividualOwner, names: OwnerNames): string {
  switch (owner) {
    case "client":
      return names.clientName;
    case "spouse":
      return names.spouseName ?? CO_CLIENT_LABEL;
    case "joint":
      return "Joint";
  }
}

/** Full owner label: entity name wins when ownerEntityId is set, otherwise falls
 *  back to the individual owner's real name. */
export function resolveOwnerLabel(args: {
  owner: IndividualOwner;
  ownerEntityId?: string | null;
  names: OwnerNames;
  entityMap: Record<string, { name: string }>;
}): string {
  if (args.ownerEntityId && args.entityMap[args.ownerEntityId]) {
    return args.entityMap[args.ownerEntityId].name;
  }
  return individualOwnerLabel(args.owner, args.names);
}

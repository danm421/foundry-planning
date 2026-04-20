// Shared helpers for turning the client/spouse/joint owner enum into human-readable
// labels. The enum stays unchanged in the database so the projection engine and
// SQL queries don't need to know real names; these helpers only affect display.

export interface OwnerNames {
  clientName: string;
  spouseName: string | null;
}

export type IndividualOwner = "client" | "spouse" | "joint";

/** Label for an individual-owner enum, using real names when available. */
export function individualOwnerLabel(owner: IndividualOwner, names: OwnerNames): string {
  switch (owner) {
    case "client":
      return names.clientName;
    case "spouse":
      return names.spouseName ?? "Spouse";
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

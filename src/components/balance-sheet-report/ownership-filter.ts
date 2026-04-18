export type OwnershipView =
  | "consolidated"
  | "client"
  | "spouse"
  | "joint"
  | "entities";

interface OwnedRow {
  owner?: "client" | "spouse" | "joint" | null;
  ownerEntityId?: string | null;
}

function isEntity(row: OwnedRow): boolean {
  return row.ownerEntityId != null;
}

function matchesPersonal(row: OwnedRow, target: "client" | "spouse" | "joint"): boolean {
  return !isEntity(row) && row.owner === target;
}

export function filterAccounts<T extends OwnedRow>(rows: T[], view: OwnershipView): T[] {
  switch (view) {
    case "consolidated":
      return rows;
    case "entities":
      return rows.filter(isEntity);
    case "client":
    case "spouse":
    case "joint":
      return rows.filter((r) => matchesPersonal(r, view));
  }
}

export function filterLiabilities<T extends OwnedRow>(rows: T[], view: OwnershipView): T[] {
  return filterAccounts(rows, view);
}

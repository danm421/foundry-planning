// One-time backfill matcher: pair legacy manually-created dependent contact
// rows with planning family members by exact (case/whitespace-insensitive)
// name. Conservative on purpose — ambiguity on either side means no link;
// leftovers stay visible as unlinked family cards for manual cleanup.

export type BackfillDependent = { id: string; firstName: string; lastName: string };
export type BackfillFamilyMember = {
  id: string;
  firstName: string;
  lastName: string | null;
  linked: boolean;
};

const key = (first: string, last: string | null) =>
  `${first.trim().toLowerCase()}|${(last ?? "").trim().toLowerCase()}`;

export function matchDependentsToFamily(
  deps: BackfillDependent[],
  fams: BackfillFamilyMember[],
): Map<string, string> {
  const famsByKey = new Map<string, BackfillFamilyMember[]>();
  for (const f of fams) {
    if (f.linked) continue;
    const k = key(f.firstName, f.lastName);
    famsByKey.set(k, [...(famsByKey.get(k) ?? []), f]);
  }
  const depsByKey = new Map<string, BackfillDependent[]>();
  for (const d of deps) {
    const k = key(d.firstName, d.lastName);
    depsByKey.set(k, [...(depsByKey.get(k) ?? []), d]);
  }
  const links = new Map<string, string>();
  for (const [k, ds] of depsByKey) {
    const fs = famsByKey.get(k) ?? [];
    if (ds.length === 1 && fs.length === 1) links.set(ds[0].id, fs[0].id);
  }
  return links;
}

// Pure split of a household's contact rows + planning family members into the
// Contacts tab's sections. Lives outside the component so it unit-tests
// without DOM. A linked row whose family member vanished (shouldn't happen —
// FK cascade — but data is data) degrades to unlinkedFamily so it stays
// visible and deletable.

export type ContactLike = {
  id: string;
  role: "primary" | "spouse" | "dependent" | "other";
  familyMemberId: string | null;
};

export function deriveContactSections<C extends ContactLike, F extends { id: string }>(
  contacts: C[],
  familyMembers: F[],
) {
  const memberIds = new Set(familyMembers.map((m) => m.id));
  // Role-filtered on purpose: a family link is a dependent-only relationship.
  // Indexing every row that happens to carry a familyMemberId would fold a
  // non-dependent into its member's card AND leave it in its own section — the
  // same contact rendered twice. Filtering here makes that invariant code
  // rather than a convention.
  const byFmId = new Map(
    contacts
      .filter((x) => x.role === "dependent" && x.familyMemberId !== null)
      .map((x) => [x.familyMemberId as string, x]),
  );
  return {
    primarySpouse: [
      ...contacts.filter((x) => x.role === "primary"),
      ...contacts.filter((x) => x.role === "spouse"),
    ],
    family: familyMembers.map((member) => ({
      member,
      contact: byFmId.get(member.id) ?? null,
    })),
    unlinkedFamily: contacts.filter(
      (x) =>
        x.role === "dependent" &&
        (x.familyMemberId === null || !memberIds.has(x.familyMemberId)),
    ),
    external: contacts.filter((x) => x.role === "other"),
  };
}

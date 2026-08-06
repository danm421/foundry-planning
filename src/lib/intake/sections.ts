//
// Which sections a data-collection form collects. One canonical ordered list;
// every other surface derives from it.
//
// ORDER LIVES HERE, NOT IN THE STORED ARRAY. A row holding
// ["documents","family"] still renders Family first. If the stored order were
// honoured, the column would quietly become a re-ordering API nobody designed
// and the Risk step could land somewhere other than the end.
//
// `welcome` and `review` are deliberately absent: they are wizard chrome and
// always render, so they are not switchable and must not appear in a stored set.

export const INTAKE_SECTIONS = [
  "family",
  "accounts",
  "income",
  "property",
  "goals",
  "documents",
  "risk",
] as const;

export type IntakeSectionKey = (typeof INTAKE_SECTIONS)[number];

/** What a form collects when nobody has said otherwise. `risk` is opt-in. */
export const DEFAULT_INTAKE_SECTIONS = [
  "family",
  "accounts",
  "income",
  "property",
  "goals",
  "documents",
] as const satisfies readonly IntakeSectionKey[];

export const INTAKE_SECTION_LABELS: Record<IntakeSectionKey, string> = {
  family: "Family",
  accounts: "Accounts",
  income: "Income",
  property: "Property",
  goals: "Goals",
  documents: "Documents",
  risk: "Risk tolerance",
};

/**
 * Order, de-duplicate, and drop unknown keys. MAY RETURN AN EMPTY ARRAY — that
 * is what lets the create route reject "a form that collects nothing" with a
 * 400 instead of silently expanding it to the default.
 *
 * Dropping unknown keys rather than throwing is deliberate: a section retired in
 * a later release must not break a form already out with a client.
 */
export function normalizeSections(raw: unknown): IntakeSectionKey[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === "string"));
  return INTAKE_SECTIONS.filter((k) => wanted.has(k));
}

/**
 * What a STORED column means. Null (the "never customized" case, which is every
 * pre-existing row), an unusable value, or a set that normalizes to nothing all
 * mean "the default set" — a read path must always yield a renderable form.
 */
export function sectionsForForm(stored: unknown): IntakeSectionKey[] {
  const normalized = normalizeSections(stored);
  return normalized.length > 0 ? normalized : [...DEFAULT_INTAKE_SECTIONS];
}

/**
 * A prospect send has no client row to borrow a date of birth from, and a
 * household with no birth year cannot be projected — so Family is not optional
 * there. Applied at WRITE time in the create route, which is why no downstream
 * surface needs a "prospect with no Family step" special case.
 */
export function forceFamilyForProspect(
  s: readonly IntakeSectionKey[],
  hasClientId: boolean,
): IntakeSectionKey[] {
  if (hasClientId || s.includes("family")) return [...s];
  return normalizeSections([...s, "family"]);
}

export const INTAKE_SECTION_PRESETS = [
  { key: "full", label: "Full intake", sections: DEFAULT_INTAKE_SECTIONS },
  {
    key: "full_risk",
    label: "Full intake + risk",
    sections: [...DEFAULT_INTAKE_SECTIONS, "risk"],
  },
  { key: "documents", label: "Documents only", sections: ["documents"] },
  { key: "risk", label: "Risk only", sections: ["risk"] },
] as const satisfies readonly {
  key: string;
  label: string;
  sections: readonly IntakeSectionKey[];
}[];

/** The preset key a set corresponds to, or null when it matches none. */
export function matchPreset(s: readonly IntakeSectionKey[]): string | null {
  const a = normalizeSections([...s]).join(",");
  for (const p of INTAKE_SECTION_PRESETS) {
    if (normalizeSections([...p.sections]).join(",") === a) return p.key;
  }
  return null;
}

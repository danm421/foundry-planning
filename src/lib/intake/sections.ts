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
  "estate",
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
  estate: "Estate",
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
 * The sections a host will actually put on screen. `documents` is the one
 * section that needs somewhere to put a file — live on the public form, inert
 * in the advisor's preview, absent in the authenticated portal — so a host with
 * no upload surface must never be handed it.
 *
 * ONE rule, ONE place: the wizard's step list, its welcome overview and its
 * review screen all derive from this call. Two filters over the same input is
 * how the welcome screen came to promise a Documents step the wizard skipped.
 */
export function renderableSections(
  s: readonly IntakeSectionKey[],
  hasUploads: boolean,
): IntakeSectionKey[] {
  return s.filter((k) => k !== "documents" || hasUploads);
}

/**
 * True when the PORTAL wizard would have nothing to show — a form collecting
 * only `documents`, which is a shipped preset. The portal is the one host with
 * no upload surface, so that form renders as Welcome → Review with nothing in
 * between, and Submit files a form that collected nothing.
 *
 * Both the proxy's soft gate and the portal intake page ask this, and they MUST
 * agree ABOUT THE SAME FORM: a gate that pushed the client at /portal/intake
 * while the page pushed them back to the Organizer is an infinite redirect —
 * strictly worse than the empty wizard it replaces. Asking the same predicate
 * of two different rows is how that happens, so the two queries share their
 * WHERE and their ORDER BY (see `queries.ts`).
 *
 * Takes the STORED value, so `null` (never customized) reads as the default set.
 */
export function portalCollectsNothing(stored: unknown): boolean {
  return renderableSections(sectionsForForm(stored), false).length === 0;
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
  // Family rides along deliberately: the estate section leans on it for the
  // children and the spouse, and the documents themselves are drafted off the
  // legal names and dates of birth that step collects.
  { key: "estate", label: "Estate details", sections: ["family", "estate"] },
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

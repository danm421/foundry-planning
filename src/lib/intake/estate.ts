/**
 * Vocabulary + display helpers for the Estate section of a data-collection form.
 *
 * The section collects what an attorney needs to START drafting: who the
 * documents name, where the client legally resides, and how the children
 * inherit. It deliberately collects NO dollar amounts — the plan already holds
 * those, and an estate questionnaire that re-asks for balances gets abandoned.
 *
 * Pure by construction (no DB, no React), so the wizard step, the review
 * screen, the advisor's diff and the CRM note all read the same wording rather
 * than each spelling out "Guardian — backup" in their own words.
 */

import {
  fiduciaryContactKey,
  isBlankIntakeFiduciaryContactRow,
  isBlankIntakeFiduciaryRow,
  INTAKE_FIDUCIARY_PRIORITIES,
  INTAKE_FIDUCIARY_ROLES,
  type IntakeDraft,
  type IntakeFiduciaryPriority,
  type IntakeFiduciaryRole,
  type IntakePayload,
} from "./schema";

// ── Fiduciary slots ──────────────────────────────────────────────────────────
//
// Three roles × two choices. Modelled as a flat list of (role, priority) pairs
// rather than six named fields because the note, the review card and the step
// all want to ITERATE it — and because a fourth role (a health-care agent, a
// financial power of attorney) is a one-line addition to the vocabulary rather
// than a new field in four files.

export interface FiduciarySlot {
  role: IntakeFiduciaryRole;
  priority: IntakeFiduciaryPriority;
}

/** Every slot the step renders, in the order it renders them. */
export const FIDUCIARY_SLOTS: readonly FiduciarySlot[] = INTAKE_FIDUCIARY_ROLES.flatMap(
  (role) => INTAKE_FIDUCIARY_PRIORITIES.map((priority) => ({ role, priority })),
);

/** Roles that name someone for the CHILDREN, and so only apply when there are
 *  children. Kept here so the step and the review card agree about which ones
 *  to hide for a household with none. */
const CHILD_ONLY_ROLES = new Set<IntakeFiduciaryRole>(["guardian"]);

export function isChildOnlyRole(role: IntakeFiduciaryRole): boolean {
  return CHILD_ONLY_ROLES.has(role);
}

export const FIDUCIARY_ROLE_LABELS: Record<IntakeFiduciaryRole, string> = {
  guardian: "Guardian",
  trustee: "Trustee",
  executor: "Executor",
};

/**
 * The question the step actually asks, in place of the job title. "Who would
 * raise your children?" is answerable by anyone; "Guardian" is a word half of
 * clients would have to look up. The title still appears as the field's chip,
 * so the client learns which is which.
 */
export const FIDUCIARY_ROLE_QUESTIONS: Record<IntakeFiduciaryRole, string> = {
  guardian: "Who would raise your children?",
  trustee: "Who should manage money left for them?",
  executor: "Who should settle your estate?",
};

/** One sentence on what the role actually does, for the step's tooltip. Plain
 *  words — this is read by a client, not an attorney. */
export const FIDUCIARY_ROLE_HELP: Record<IntakeFiduciaryRole, string> = {
  guardian:
    "The person who raises your children if neither of you can. Courts follow this nomination in almost every case.",
  trustee:
    "The person who manages money left in trust for your children — invests it, and decides what gets paid out for their care.",
  executor:
    "The person who settles your estate: files the will, pays the final bills and taxes, and distributes what is left.",
};

export const FIDUCIARY_PRIORITY_LABELS: Record<IntakeFiduciaryPriority, string> = {
  primary: "First choice",
  backup: "Backup",
};

/** "Guardian · Backup" — the one label every surface shows for a slot. */
export function fiduciarySlotLabel(slot: FiduciarySlot): string {
  return `${FIDUCIARY_ROLE_LABELS[slot.role]} · ${FIDUCIARY_PRIORITY_LABELS[slot.priority]}`;
}

// ── Nominations ──────────────────────────────────────────────────────────────

type EstateSlice = IntakeDraft["estate"];
type FiduciaryRow = NonNullable<NonNullable<EstateSlice>["fiduciaries"]>[number];
type ContactRow = NonNullable<NonNullable<EstateSlice>["fiduciaryContacts"]>[number];

/** The row filling a slot, or undefined. First match wins — the step writes at
 *  most one row per slot, and a payload that somehow carries two is read the
 *  same way by every surface. */
export function findFiduciary<T extends FiduciarySlot>(
  rows: readonly T[] | undefined,
  slot: FiduciarySlot,
): T | undefined {
  return rows?.find((r) => r.role === slot.role && r.priority === slot.priority);
}

/**
 * Upsert one slot's row, preserving list order. A slot the client is filling in
 * for the first time is APPENDED rather than inserted in slot order: the array
 * is read through `findFiduciary` everywhere, so its order is presentation-free,
 * and appending keeps React's keys stable while a card is being typed into.
 */
export function setFiduciary<T extends FiduciarySlot>(
  rows: readonly T[] | undefined,
  slot: FiduciarySlot,
  next: T,
): T[] {
  const list = rows ?? [];
  const idx = list.findIndex(
    (r) => r.role === slot.role && r.priority === slot.priority,
  );
  if (idx === -1) return [...list, next];
  return list.map((r, i) => (i === idx ? next : r));
}

// ── Contact details, asked once per PERSON ───────────────────────────────────
//
// The same brother is routinely both trustee and executor, and the source
// questionnaire asks for "contact info and city for anyone named above" as ONE
// question rather than per role. So the contact details hang off the person,
// keyed by name, and the step renders one card per distinct name — six roles
// never mean six phone numbers.
//
// Name-as-key is the right identity here precisely because the name is all the
// client has given us: there is no id to point at, and re-typing the name is
// exactly the case where the details should be re-asked. A rename leaves its old
// card unreferenced, and `pruneIntakeBlankRows` drops it at submit.

/**
 * Everyone named across the slots, de-duplicated, in the order they were first
 * named — which is the order their contact cards then appear in.
 *
 * Fill order rather than slot order so a card never jumps position while the
 * client is typing into it: naming a guardian AFTER a trustee must not slide the
 * trustee's half-filled card down the page.
 *
 * Returns the FIRST spelling of each name, which is the one their contact card
 * is filed under.
 */
export function namedFiduciaries(
  rows: readonly { name?: string }[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows ?? []) {
    const name = row.name?.trim();
    if (!name) continue;
    const key = fiduciaryContactKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** The roles one person has been named for, e.g. "Trustee · First choice". */
export function rolesForName(
  rows: readonly (FiduciarySlot & { name?: string })[] | undefined,
  name: string,
): string[] {
  const key = fiduciaryContactKey(name);
  return FIDUCIARY_SLOTS.filter((slot) => {
    const row = findFiduciary(rows, slot);
    return row !== undefined && fiduciaryContactKey(row.name) === key;
  }).map(fiduciarySlotLabel);
}

export function findContact<T extends { name?: string }>(
  contacts: readonly T[] | undefined,
  name: string,
): T | undefined {
  const key = fiduciaryContactKey(name);
  return contacts?.find((c) => fiduciaryContactKey(c.name) === key);
}

export function setContact<T extends { name?: string }>(
  contacts: readonly T[] | undefined,
  name: string,
  next: T,
): T[] {
  const key = fiduciaryContactKey(name);
  const list = contacts ?? [];
  const idx = list.findIndex((c) => fiduciaryContactKey(c.name) === key);
  if (idx === -1) return [...list, next];
  return list.map((c, i) => (i === idx ? next : c));
}

/** "sister · Ann Arbor, MI · 734-555-0100" — a contact card as one line, for
 *  the note and the review card. */
export function fiduciaryContactLine(
  contact: { relationship?: string; city?: string; phone?: string; email?: string } | undefined,
): string | null {
  if (!contact) return null;
  const parts = [
    contact.relationship?.trim(),
    contact.city?.trim(),
    contact.phone?.trim(),
    contact.email?.trim(),
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── How the children receive assets ──────────────────────────────────────────

/**
 * The firm's recommended schedule, in the client's words.
 *
 * Held as data rather than JSX so the step, the review card and the CRM note
 * all quote the SAME terms. An advisor reading the note six months later needs
 * to know exactly what the client agreed to — "chose the suggested schedule"
 * with no schedule attached is not a record of anything.
 */
export const SUGGESTED_CHILD_DISTRIBUTION_TERMS: readonly string[] = [
  "Income and principal available for health, education, maintenance and support",
  "Each child can become their own trustee at 25",
  "One third of the principal at 25, half of the balance at 30, the rest at 35",
];

/** One line, for the note and the review card. */
// Spelled out rather than slash-joined ("health/education/maintenance/support"):
// that run is one unbreakable token to a text layout engine, and it pushed the
// client's review card past the edge of a phone screen.
export const SUGGESTED_CHILD_DISTRIBUTION_SUMMARY =
  "Suggested schedule — health, education, maintenance and support; own trustee at 25; ⅓ at 25, ½ at 30, balance at 35";

/** The caveat shown under the suggested option: this covers in-estate assets
 *  only, and the out-of-estate work that comes later usually holds assets far
 *  longer. Said up front so the schedule doesn't read as the whole plan. */
export const SUGGESTED_CHILD_DISTRIBUTION_CAVEAT =
  "This covers the assets in your estate. We'd look at out-of-estate planning later, which would most likely keep assets in trust for your children and grandchildren much longer.";

// ── Emptiness ────────────────────────────────────────────────────────────────

/**
 * True only when the client left the whole step alone.
 *
 * Drives the wizard's "Skip for now" label and the review card's empty state,
 * so the two can't disagree about whether the step was answered. A slot card
 * opened and abandoned is NOT content — that's the same row submit prunes.
 */
export function isEstateEmpty(estate: EstateSlice): boolean {
  if (!estate) return true;
  const filled = (v: unknown) =>
    typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;

  const c = estate.contact;
  if (
    filled(c?.primary?.mobile) ||
    filled(c?.primary?.email) ||
    filled(c?.spouse?.mobile) ||
    filled(c?.spouse?.email)
  ) {
    return false;
  }

  const r = estate.residence;
  if (
    filled(r?.addressLine1) ||
    filled(r?.addressLine2) ||
    filled(r?.city) ||
    filled(r?.state) ||
    filled(r?.postalCode) ||
    filled(r?.isLegalResidence) ||
    filled(r?.legalResidenceNote)
  ) {
    return false;
  }

  if (!(estate.fiduciaries ?? []).every(isBlankIntakeFiduciaryRow)) return false;
  if (!(estate.fiduciaryContacts ?? []).every(isBlankIntakeFiduciaryContactRow)) {
    return false;
  }

  const d = estate.childrenDistribution;
  return !(filled(d?.plan) || filled(d?.note));
}

// ── Reading the household off the payload ────────────────────────────────────
//
// The Estate step needs three facts the Family step already collected: the
// principals' names (so the fields read "Matt", not "You"), whether there is a
// spouse, and whether there are children. It reads them rather than re-asking —
// a client who has just typed their children's names on the previous step and
// is asked for them again reasonably concludes the form is broken.

type Family = IntakeDraft["family"];

export interface EstateHousehold {
  /** Display name for the primary, e.g. "Matt". Falls back to "You". */
  primaryName: string;
  /** Display name for the spouse, or null when the form has no spouse. */
  spouseName: string | null;
  /** Render the spouse's fields at all. */
  hasSpouse: boolean;
  /** Render guardianship + the children's distribution schedule. */
  hasChildren: boolean;
  /** The children's first names, for the guardianship context line. */
  childNames: string[];
}

/**
 * What the Estate step should show for this household.
 *
 * The UNKNOWN case is the interesting one: a form that does not collect Family
 * carries no family slice at all (see `snapshotClientToPayload`), and a section
 * that hid its spouse and children questions on that basis would silently
 * collect half an estate questionnaire. So absence means SHOW — only an
 * explicit "no spouse" / "no children" from the Family step hides anything.
 */
export function estateHousehold(family: Family): EstateHousehold {
  const known = family !== undefined;
  const primaryName = family?.primary?.firstName?.trim() || "You";
  const spouseName = family?.spouse?.firstName?.trim() || null;
  const childNames = (family?.children ?? [])
    .map((c) => c.firstName?.trim() ?? "")
    .filter((n) => n !== "");

  return {
    primaryName,
    spouseName,
    hasSpouse: known ? family?.spouse != null : true,
    hasChildren: known ? (family?.children ?? []).length > 0 : true,
    childNames,
  };
}

/** Same question, asked of a submitted payload. */
export function estateHouseholdFromPayload(
  family: IntakePayload["family"],
): EstateHousehold {
  return estateHousehold(family ?? undefined);
}

/** Slots to render for this household: guardianship disappears for a household
 *  the Family step says has no children. */
export function estateSlotsFor(household: EstateHousehold): FiduciarySlot[] {
  return FIDUCIARY_SLOTS.filter(
    (s) => household.hasChildren || !isChildOnlyRole(s.role),
  );
}

/** Row types re-exported for the step, which builds rows before it has a
 *  narrowed draft slice to infer them from. */
export type IntakeFiduciaryRow = FiduciaryRow;
export type IntakeFiduciaryContactRow = ContactRow;

// ── One-line renderings ──────────────────────────────────────────────────────
//
// The review card, the advisor's queue detail and the CRM note all show the
// same three facts. They render them THROUGH these helpers rather than each
// assembling their own string, so the client's review screen and the note filed
// on the household can't describe the same answer two different ways.

type Residence = NonNullable<EstateSlice>["residence"];
type Distribution = NonNullable<EstateSlice>["childrenDistribution"];

/** "123 Maple St, Apt 2, Ann Arbor, MI 48104" — or null when nothing was
 *  entered. Blanks are dropped before joining, so a client who gave only a city
 *  and state gets "Ann Arbor, MI" rather than a string of stray commas. */
export function formatEstateAddress(residence: Residence): string | null {
  if (!residence) return null;
  const street = [residence.addressLine1?.trim(), residence.addressLine2?.trim()]
    .filter(Boolean)
    .join(", ");
  const cityState = [residence.city?.trim(), residence.state?.trim()]
    .filter(Boolean)
    .join(", ");
  const line = [street, cityState].filter(Boolean).join(", ");
  const withZip = [line, residence.postalCode?.trim()].filter(Boolean).join(" ");
  return withZip || null;
}

/** "Yes" · "No — Florida" · null when unanswered. The unanswered case stays
 *  null all the way through: a question nobody answered must not render as a
 *  "No" on the advisor's screen. */
export function legalResidenceLabel(residence: Residence): string | null {
  if (!residence || residence.isLegalResidence === undefined) return null;
  if (residence.isLegalResidence) return "Yes";
  const where = residence.legalResidenceNote?.trim();
  return where ? `No — ${where}` : "No";
}

/** What the client chose for the children's inheritance, in one line. */
export function childDistributionLabel(distribution: Distribution): string | null {
  const plan = distribution?.plan;
  if (plan === "suggested") return SUGGESTED_CHILD_DISTRIBUTION_SUMMARY;
  if (plan === "custom") return "Their own instructions";
  return null;
}

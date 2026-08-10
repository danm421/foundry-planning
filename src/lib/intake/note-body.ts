/**
 * A submitted intake form as a CRM note body.
 *
 * Everything the client typed is applied SOMEWHERE — accounts become account
 * rows, income becomes income rows — but the plan keeps the numbers, not the
 * telling. Six months on, the advisor opening the household sees a portfolio,
 * not "here is what they said they wanted when they signed up". This module is
 * that record: one markdown snapshot, filed on the timeline, that survives every
 * later edit to the plan.
 *
 * Pure by construction — no DB, no clock (the year is passed in, the same way
 * `goal-rows.ts` and `income-years.ts` take it), so it stays testable in plain
 * vitest away from the apply transaction.
 */

import {
  beneficiaryName,
  goalSpanLabel,
  goalTopicLabel,
  goalTypeLabel,
} from "@/lib/intake/goal-rows";
import { incomeSpanLabel } from "@/lib/intake/income-years";
import type { IntakePayload } from "@/lib/intake/schema";
import {
  INTAKE_SECTIONS,
  INTAKE_SECTION_LABELS,
  type IntakeSectionKey,
} from "@/lib/intake/sections";
import { formatAccountCategory } from "@/lib/accounts/category-labels";
import { individualOwnerLabel } from "@/lib/owner-labels";

// ── Wording ──────────────────────────────────────────────────────────────────
//
// Keyed by the schema's own unions so adding a member is a type error until it
// is given wording, matching the pattern in `goal-rows.ts`.

type Owner = IntakePayload["accounts"][number]["owner"];

// Account categories are NOT re-mapped here — `formatAccountCategory` already
// owns that wording for every display surface, and its fallback title-cases an
// unknown value rather than leaking a raw enum.

const INCOME_TYPE_LABELS: Record<IntakePayload["income"][number]["type"], string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  other: "Other",
};

const PROPERTY_KIND_LABELS: Record<IntakePayload["property"][number]["kind"], string> = {
  real_estate: "Real estate",
  business: "Business",
};

type MaritalStatus = NonNullable<
  NonNullable<IntakePayload["family"]>["primary"]["maritalStatus"]
>;

const MARITAL_LABELS: Record<MaritalStatus, string> = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
};

// ── Primitives ───────────────────────────────────────────────────────────────

function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** "1975-04-02" → "Apr 2, 1975", UTC-pinned so the day never shifts. */
function fmtDob(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fullName(p: { firstName?: string; lastName?: string } | undefined): string | null {
  const name = [p?.firstName?.trim(), p?.lastName?.trim()].filter(Boolean).join(" ");
  return name || null;
}

/**
 * An owner as the advisor reads it, through the shared display helper. Falls
 * back to the generic word when Family was not collected — an accounts-only
 * form has owners but no names to put to them.
 */
function ownerLabel(owner: Owner | undefined, family: IntakePayload["family"]): string {
  return individualOwnerLabel(owner ?? "client", {
    clientName: family?.primary?.firstName?.trim() || "Client",
    spouseName: family?.spouse?.firstName?.trim() || null,
  });
}

/**
 * Join non-empty parts with a middot, the separator used across the app.
 *
 * Dropping the blanks BEFORE joining is the whole point: passing a name as the
 * first part and its optional details after it yields "Jane Doe · b. Apr 2,
 * 1975" or a bare "Jane Doe", with no dangling separator either way.
 */
function detail(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/**
 * A type label is worth printing only when it says something the row's own name
 * does not. The wizard pre-fills an income row's name from its type, so most
 * households would otherwise get "Salary — Salary · $180,000/yr".
 */
function unlessEchoed(name: string, label: string): string | null {
  return name.trim().toLowerCase() === label.trim().toLowerCase() ? null : label;
}

/** Markdown blockquote, preserving the client's own line breaks. */
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────────────
//
// Each builder returns the section's LINES, or an empty array when the client
// left it blank. An empty array means the heading is never emitted — a note
// reading "## Accounts" with nothing under it says the client answered when
// they did not.

function goalsLines(payload: IntakePayload, currentYear: number): string[] {
  const goals = payload.goals;
  if (!goals) return [];
  const out: string[] = [];

  const retirement = [
    goals.clientRetirementAge ? `Client retires at ${goals.clientRetirementAge}` : null,
    goals.spouseRetirementAge ? `Spouse retires at ${goals.spouseRetirementAge}` : null,
    goals.annualRetirementExpenses
      ? `Target spending in retirement: ${usd(goals.annualRetirementExpenses)}/yr`
      : null,
  ].filter((v): v is string => v !== null);
  if (retirement.length > 0) {
    out.push("**Retirement**", ...retirement.map((r) => `- ${r}`));
  }

  const funded = goals.expenseGoals ?? [];
  if (funded.length > 0) {
    if (out.length > 0) out.push("");
    out.push("**Goals they want funded**");
    for (const g of funded) {
      const forWhom = beneficiaryName(g.forWhom, payload.family);
      out.push(
        `- ${g.name} — ${detail(
          goalTypeLabel(g.type),
          `${usd(g.amount)}${(g.years ?? 1) > 1 ? "/yr" : ""}`,
          goalSpanLabel(g, currentYear),
          forWhom ? `for ${forWhom}` : null,
        )}`,
      );
    }
  }

  // "On your radar" — checked boxes carry no amount and no date, so they are
  // deliberately not expense rows. This note is the only place they land.
  const topics = goals.topics ?? [];
  if (topics.length > 0) {
    if (out.length > 0) out.push("");
    out.push("**On their radar**", ...topics.map((t) => `- ${goalTopicLabel(t)}`));
  }

  const note = goals.topicsNote?.trim();
  if (note) {
    if (out.length > 0) out.push("");
    out.push(quote(note));
  }

  return out;
}

function familyLines(payload: IntakePayload): string[] {
  const family = payload.family;
  if (!family) return [];
  const out: string[] = [];

  const primaryDob = fmtDob(family.primary?.dateOfBirth);
  const marital = family.primary?.maritalStatus;
  const primary = fullName(family.primary);
  if (primary) {
    out.push(
      `- ${detail(
        primary,
        primaryDob ? `b. ${primaryDob}` : null,
        marital ? MARITAL_LABELS[marital] ?? marital : null,
      )}`,
    );
  }

  const spouse = fullName(family.spouse ?? undefined);
  if (spouse) {
    const dob = fmtDob(family.spouse?.dateOfBirth);
    out.push(`- ${detail(`Spouse: ${spouse}`, dob ? `b. ${dob}` : null)}`);
  }

  for (const child of family.children ?? []) {
    const name = fullName(child);
    if (!name) continue;
    const dob = fmtDob(child.dateOfBirth);
    out.push(`- ${detail(`Child: ${name}`, dob ? `b. ${dob}` : null)}`);
  }

  if (family.stateOfResidence) {
    out.push(`- State of residence: ${family.stateOfResidence}`);
  }

  return out;
}

function accountsLines(payload: IntakePayload): string[] {
  return (payload.accounts ?? []).map(
    (a) =>
      `- ${a.name} — ${detail(
        unlessEchoed(a.name, formatAccountCategory(a.category)),
        usd(a.value),
        ownerLabel(a.owner, payload.family),
        a.custodian?.trim() || null,
        a.basis !== undefined ? `basis ${usd(a.basis)}` : null,
      )}`,
  );
}

function incomeLines(payload: IntakePayload, currentYear: number): string[] {
  return (payload.income ?? []).map(
    (i) =>
      `- ${i.name} — ${detail(
        unlessEchoed(i.name, INCOME_TYPE_LABELS[i.type] ?? i.type),
        `${usd(i.annualAmount)}/yr`,
        ownerLabel(i.owner, payload.family),
        incomeSpanLabel(i, currentYear),
      )}`,
  );
}

function propertyLines(payload: IntakePayload): string[] {
  const out: string[] = [];
  for (const p of payload.property ?? []) {
    out.push(
      `- ${p.name} — ${detail(
        PROPERTY_KIND_LABELS[p.kind] ?? p.kind,
        usd(p.value),
        ownerLabel(p.owner, payload.family),
      )}`,
    );

    const carrying = detail(
      p.annualPropertyTax !== undefined ? `Property tax ${usd(p.annualPropertyTax)}/yr` : null,
      p.annualInsurance !== undefined ? `Insurance ${usd(p.annualInsurance)}/yr` : null,
    );
    if (carrying) out.push(`  - ${carrying}`);

    const m = p.mortgage;
    const mortgage = m
      ? detail(
          m.balance !== undefined ? `${usd(m.balance)} balance` : null,
          m.yearsRemaining !== undefined ? `${m.yearsRemaining} yrs remaining` : null,
          m.interestRatePct !== undefined ? `${m.interestRatePct}%` : null,
          m.monthlyPayment !== undefined ? `${usd(m.monthlyPayment)}/mo` : null,
        )
      : "";
    if (mortgage) out.push(`  - Mortgage: ${mortgage}`);
  }
  return out;
}

/**
 * Risk is summarised, never transcribed. The answers are `{questionId:
 * optionId}` pairs that mean nothing without the questionnaire in front of you,
 * and the SCORE already lands on the client's risk profile. What has nowhere
 * else to go is the sentence the client wrote about how markets feel.
 */
function riskLines(payload: IntakePayload): string[] {
  const risk = payload.risk;
  if (!risk) return [];
  const out: string[] = [];

  const answered = Object.keys(risk.answers ?? {}).length;
  if (answered > 0) {
    out.push(`- Questionnaire completed — ${answered} answers, scored on the client's profile`);
  }

  const note = risk.environmentNote?.trim();
  if (note) {
    if (out.length > 0) out.push("");
    out.push(quote(note));
  }

  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * GOALS LEADS, then the rest in the canonical order.
 *
 * Deliberate departure from `INTAKE_SECTIONS`: the notes list renders a 200-char
 * preview of the body, and the numeric sections are all applied as real rows the
 * advisor can read off the plan itself. Goals is the section whose content — the
 * radar topics, the free-text note, the names the client gave their goals — has
 * nowhere else to live, so it earns both the top of the note and the preview.
 */
// `documents` is deliberately absent: uploads are not in the payload and
// already land in the household's document vault with their own activity row.
type NotedSection = Exclude<IntakeSectionKey, "documents">;

function isNoted(key: IntakeSectionKey): key is NotedSection {
  return key !== "documents";
}

/**
 * DERIVED from the canonical list, not retyped — expressed as "goals, then
 * everything else in `INTAKE_SECTIONS` order" so a section added upstream flows
 * in here automatically instead of being silently dropped from the note.
 */
const SECTION_ORDER: readonly NotedSection[] = [
  "goals",
  ...INTAKE_SECTIONS.filter(isNoted).filter((k) => k !== "goals"),
];

/**
 * Render a submitted payload as markdown, or null when there is nothing worth
 * filing (a documents-only form, or a client who submitted a blank wizard).
 *
 * `sections` GATES the output and the payload does not. A prefilled form seeds
 * its payload from the client snapshot whatever the advisor chose to collect —
 * `snapshotClientToPayload` populates `goals` unconditionally — so rendering
 * whatever the payload happens to hold would file goals the client never saw as
 * though they had just told us. Same rule the wizard and the review diff follow.
 */
export function intakeNoteBody(
  payload: IntakePayload,
  sections: readonly IntakeSectionKey[],
  opts: { currentYear: number },
): string | null {
  const collected = new Set(sections);
  const blocks: string[] = [];

  // A total Record, so a section added to `IntakeSectionKey` is a compile error
  // here until it is given a builder — the fall-through arm of a ternary chain
  // would instead have quietly rendered the previous section's content.
  const builders: Record<NotedSection, () => string[]> = {
    goals: () => goalsLines(payload, opts.currentYear),
    family: () => familyLines(payload),
    accounts: () => accountsLines(payload),
    income: () => incomeLines(payload, opts.currentYear),
    property: () => propertyLines(payload),
    risk: () => riskLines(payload),
  };

  for (const key of SECTION_ORDER) {
    if (!collected.has(key)) continue;
    const lines = builders[key]();
    if (lines.length === 0) continue;
    blocks.push(`## ${INTAKE_SECTION_LABELS[key]}\n${lines.join("\n")}`);
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

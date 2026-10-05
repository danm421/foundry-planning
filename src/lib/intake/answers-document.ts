/**
 * A submitted data-collection form, laid out for the downloadable PDF.
 *
 * The PDF is the client's answers as a document — every section the form
 * collected, in the order the client filled it in, and nothing the form never
 * asked. It is NOT the review screen's diff: on an applied form the plan already
 * holds these answers, so a diff against it would show nothing changed.
 *
 * The output is a short list of generic blocks (fields, tables, lists, quotes)
 * so the renderer stays a dumb printer. Every string is built with the same
 * wording helpers the CRM note uses (`note-body.ts`, `lib/intake/estate`), so
 * the PDF and the note filed on the household describe an answer the same way.
 *
 * Pure — no DB, no clock (the year is passed in, as `note-body.ts` takes it).
 */

import { intakeAccountTypeLabel } from "@/lib/intake/account-types";
import { intakeDocTypeLabel, type IntakeDocumentView } from "@/lib/intake/document-types";
import {
  FIDUCIARY_SLOTS,
  SUGGESTED_CHILD_DISTRIBUTION_SUMMARY,
  childDistributionLabel,
  estateHouseholdFromPayload,
  fiduciaryContactLine,
  fiduciarySlotLabel,
  findContact,
  findFiduciary,
  formatEstateAddress,
  inheritanceSummaryLine,
  legalResidenceLabel,
  predeceasedLabel,
  resolveEstateBeneficiaries,
  sharePercentLabel,
} from "@/lib/intake/estate";
import {
  beneficiaryName,
  goalSpanLabel,
  goalTopicLabel,
  goalTypeLabel,
} from "@/lib/intake/goal-rows";
import { incomeSpanLabel } from "@/lib/intake/income-years";
import { answeredSocialSecurity } from "@/lib/intake/social-security";
import {
  INCOME_TYPE_LABELS,
  MARITAL_LABELS,
  PROPERTY_KIND_LABELS,
  fmtDob,
  fullName,
  ownerLabel,
  usd,
} from "@/lib/intake/wording";
import type { IntakePayload } from "@/lib/intake/schema";
import {
  INTAKE_SECTIONS,
  INTAKE_SECTION_LABELS,
  type IntakeSectionKey,
} from "@/lib/intake/sections";
import { formatHouseholdName } from "@/lib/presentations/household-name";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { summarizeRtq } from "@/lib/risk/rtq";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnswerField {
  label: string;
  value: string;
}

export interface AnswerColumn {
  label: string;
  /** Flex weight of the column. */
  flex: number;
  align?: "right";
}

export interface AnswerTableRow {
  cells: string[];
  /** A muted second line under the row — a property's carrying costs. */
  note?: string;
}

export type AnswerBlock =
  | { kind: "people"; people: { role: string; name: string; fields: AnswerField[] }[] }
  | { kind: "fields"; heading?: string; fields: AnswerField[] }
  | {
      kind: "table";
      heading?: string;
      columns: AnswerColumn[];
      rows: AnswerTableRow[];
      total?: string[];
    }
  | { kind: "list"; heading?: string; items: string[] }
  | { kind: "quote"; heading?: string; text: string }
  | { kind: "empty"; text: string };

export interface AnswerSection {
  key: IntakeSectionKey;
  title: string;
  blocks: AnswerBlock[];
}

export interface IntakeAnswersDocument {
  householdName: string;
  completedBy: string;
  sentOn: string | null;
  submittedOn: string;
  sections: AnswerSection[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DASH = "—";

/** "October 3, 2026", UTC-pinned so the day matches the stored timestamp. */
function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function detail(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** The answered fields, in order — a null is a question left blank. */
function fieldsOf(...fields: (AnswerField | null)[]): AnswerField[] {
  return fields.filter((f): f is AnswerField => f !== null);
}

/** A collected section the client left blank says so, rather than vanishing. */
function orEmpty(blocks: AnswerBlock[], text: string): AnswerBlock[] {
  return blocks.length > 0 ? blocks : [{ kind: "empty", text }];
}

/**
 * A table whose last column is the amount, totalled when there is more than one
 * row. An `optional` column no row filled in is dropped: custodian and cost
 * basis are optional on every row, and a column of dashes says nothing while
 * squeezing the ones that do.
 */
function moneyTable(
  columns: (AnswerColumn & { optional?: boolean })[],
  rows: AnswerTableRow[],
  amounts: number[],
  heading?: string,
): AnswerBlock {
  const keep = columns.map((c, i) => !c.optional || rows.some((r) => r.cells[i] !== DASH));
  const pick = <T>(xs: T[]) => xs.filter((_, i) => keep[i]);
  const total =
    amounts.length > 1
      ? ["Total", ...Array<string>(columns.length - 2).fill(""), usd(amounts.reduce((a, b) => a + b, 0))]
      : undefined;
  return {
    kind: "table",
    ...(heading ? { heading } : {}),
    columns: pick(columns).map(({ label, flex, align }) => (align ? { label, flex, align } : { label, flex })),
    rows: rows.map((r) => ({ ...r, cells: pick(r.cells) })),
    ...(total ? { total: pick(total) } : {}),
  };
}

// ── Sections ─────────────────────────────────────────────────────────────────

function familyBlocks(payload: IntakePayload): AnswerBlock[] {
  const family = payload.family;
  const blocks: AnswerBlock[] = [];

  const people: { role: string; name: string; fields: AnswerField[] }[] = [];
  const primaryName = fullName(family?.primary);
  if (primaryName) {
    const marital = family?.primary?.maritalStatus;
    people.push({
      role: "Client",
      name: primaryName,
      fields: [
        { label: "Date of birth", value: fmtDob(family?.primary?.dateOfBirth) ?? DASH },
        ...(marital ? [{ label: "Marital status", value: MARITAL_LABELS[marital] ?? marital }] : []),
      ],
    });
  }
  const spouseName = fullName(family?.spouse ?? undefined);
  if (spouseName) {
    people.push({
      role: CO_CLIENT_LABEL,
      name: spouseName,
      fields: [{ label: "Date of birth", value: fmtDob(family?.spouse?.dateOfBirth) ?? DASH }],
    });
  }
  if (people.length > 0) blocks.push({ kind: "people", people });

  const children = (family?.children ?? [])
    .map((c) => ({ name: fullName(c), dob: fmtDob(c.dateOfBirth) }))
    .filter((c): c is { name: string; dob: string | null } => c.name !== null);
  if (children.length > 0) {
    blocks.push({
      kind: "table",
      heading: "Children",
      columns: [
        { label: "Name", flex: 2 },
        { label: "Date of birth", flex: 1, align: "right" },
      ],
      rows: children.map((c) => ({ cells: [c.name, c.dob ?? DASH] })),
    });
  }

  if (family?.stateOfResidence) {
    blocks.push({
      kind: "fields",
      fields: [{ label: "State of residence", value: family.stateOfResidence }],
    });
  }

  return orEmpty(blocks, "No family details entered.");
}

function accountsBlocks(payload: IntakePayload): AnswerBlock[] {
  const accounts = payload.accounts ?? [];
  if (accounts.length === 0) return [{ kind: "empty", text: "No accounts added." }];
  const columns = [
    { label: "Account", flex: 2.2 },
    { label: "Type", flex: 1.4 },
    { label: "Owner", flex: 1 },
    { label: "Custodian", flex: 1.3, optional: true },
    { label: "Cost basis", flex: 1.1, align: "right" as const, optional: true },
    { label: "Value", flex: 1.1, align: "right" as const },
  ];
  const rows = accounts.map((a) => ({
    cells: [
      a.name,
      intakeAccountTypeLabel(a),
      ownerLabel(a.owner, payload.family),
      a.custodian?.trim() || DASH,
      a.basis === undefined ? DASH : usd(a.basis),
      usd(a.value),
    ],
  }));
  return [moneyTable(columns, rows, accounts.map((a) => a.value))];
}

function incomeBlocks(payload: IntakePayload, currentYear: number): AnswerBlock[] {
  const income = payload.income ?? [];
  const blocks: AnswerBlock[] = [];
  if (income.length > 0) {
    const columns = [
      { label: "Source", flex: 2.2 },
      { label: "Type", flex: 1.3 },
      { label: "Owner", flex: 1 },
      { label: "Years", flex: 1.4 },
      { label: "Per year", flex: 1.1, align: "right" as const },
    ];
    const rows = income.map((i) => ({
      cells: [
        i.name,
        INCOME_TYPE_LABELS[i.type] ?? i.type,
        ownerLabel(i.owner, payload.family),
        incomeSpanLabel(i, currentYear),
        usd(i.annualAmount),
      ],
    }));
    blocks.push(moneyTable(columns, rows, income.map((i) => i.annualAmount)));
  }

  // Asked on the Income step, one row per person: benefit at full retirement
  // age and the age they plan to start — worded as the review and note word it.
  const ss = answeredSocialSecurity(payload.socialSecurity, payload.family);
  if (ss.length > 0) {
    blocks.push({
      kind: "fields",
      heading: "Social Security",
      fields: ss.map((p) => ({ label: p.name, value: p.label })),
    });
  }

  return orEmpty(blocks, "No income sources added.");
}

function propertyBlocks(payload: IntakePayload): AnswerBlock[] {
  const property = payload.property ?? [];
  if (property.length === 0) return [{ kind: "empty", text: "No property added." }];
  const columns = [
    { label: "Name", flex: 2.2 },
    { label: "Type", flex: 1.2 },
    { label: "Owner", flex: 1 },
    { label: "Cost basis", flex: 1.1, align: "right" as const, optional: true },
    { label: "Value", flex: 1.1, align: "right" as const },
  ];
  const rows = property.map((p) => {
    const m = p.mortgage;
    const mortgage = m
      ? detail(
          m.balance !== undefined ? `${usd(m.balance)} balance` : null,
          m.yearsRemaining !== undefined ? `${m.yearsRemaining} yrs remaining` : null,
          m.interestRatePct !== undefined ? `${m.interestRatePct}%` : null,
          m.monthlyPayment !== undefined ? `${usd(m.monthlyPayment)}/mo` : null,
        )
      : null;
    const note = detail(
      p.annualPropertyTax !== undefined ? `Property tax ${usd(p.annualPropertyTax)}/yr` : null,
      p.annualInsurance !== undefined ? `Insurance ${usd(p.annualInsurance)}/yr` : null,
      // A ticked mortgage box with nothing filled in is still worth printing:
      // it tells the advisor there is a loan to chase down.
      m ? `Mortgage${mortgage ? `: ${mortgage}` : ""}` : null,
    );
    return {
      cells: [
        p.name,
        PROPERTY_KIND_LABELS[p.kind] ?? p.kind,
        ownerLabel(p.owner, payload.family),
        p.basis === undefined ? DASH : usd(p.basis),
        usd(p.value),
      ],
      ...(note ? { note } : {}),
    };
  });
  return [moneyTable(columns, rows, property.map((p) => p.value))];
}

function goalsBlocks(payload: IntakePayload, currentYear: number): AnswerBlock[] {
  const goals = payload.goals;
  const blocks: AnswerBlock[] = [];
  const names = {
    client: payload.family?.primary?.firstName?.trim() || "Client",
    spouse: payload.family?.spouse?.firstName?.trim() || CO_CLIENT_LABEL,
  };

  const retirement = fieldsOf(
    goals?.clientRetirementAge
      ? { label: `${names.client}'s retirement age`, value: String(goals.clientRetirementAge) }
      : null,
    goals?.spouseRetirementAge
      ? { label: `${names.spouse}'s retirement age`, value: String(goals.spouseRetirementAge) }
      : null,
    goals?.annualRetirementExpenses
      ? { label: "Spending in retirement", value: `${usd(goals.annualRetirementExpenses)}/yr` }
      : null,
  );
  if (retirement.length > 0) blocks.push({ kind: "fields", heading: "Retirement", fields: retirement });

  const funded = goals?.expenseGoals ?? [];
  if (funded.length > 0) {
    blocks.push({
      kind: "table",
      heading: "Goals to fund",
      columns: [
        { label: "Goal", flex: 2.2 },
        { label: "Type", flex: 1.3 },
        { label: "For", flex: 1 },
        { label: "When", flex: 1 },
        { label: "Amount", flex: 1.2, align: "right" },
      ],
      rows: funded.map((g) => ({
        cells: [
          g.name,
          goalTypeLabel(g.type),
          beneficiaryName(g.forWhom, payload.family) ?? DASH,
          goalSpanLabel(g, currentYear),
          `${usd(g.amount)}${(g.years ?? 1) > 1 ? "/yr" : ""}`,
        ],
      })),
    });
  }

  const topics = goals?.topics ?? [];
  if (topics.length > 0) {
    blocks.push({ kind: "list", heading: "On their radar", items: topics.map(goalTopicLabel) });
  }

  const note = goals?.topicsNote?.trim();
  if (note) blocks.push({ kind: "quote", heading: "In their words", text: note });

  return orEmpty(blocks, "No goals entered.");
}

function estateBlocks(payload: IntakePayload): AnswerBlock[] {
  const estate = payload.estate;
  const family = payload.family ?? undefined;
  const blocks: AnswerBlock[] = [];

  const contact = (who: "primary" | "spouse", label: string): AnswerField | null => {
    const c = estate?.contact?.[who];
    const value = detail(c?.mobile?.trim(), c?.email?.trim());
    return value ? { label, value } : null;
  };
  const contacts = fieldsOf(
    contact("primary", fullName(family?.primary) ?? "Client"),
    contact("spouse", fullName(family?.spouse ?? undefined) ?? CO_CLIENT_LABEL),
  );
  if (contacts.length > 0) blocks.push({ kind: "fields", heading: "Contact", fields: contacts });

  const address = formatEstateAddress(estate?.residence);
  const legal = legalResidenceLabel(estate?.residence);
  const residence = fieldsOf(
    address ? { label: "Address", value: address } : null,
    legal ? { label: "Legal residence for documents", value: legal } : null,
  );
  if (residence.length > 0) blocks.push({ kind: "fields", heading: "Residence", fields: residence });

  const nominations = FIDUCIARY_SLOTS.flatMap((slot) => {
    const name = findFiduciary(estate?.fiduciaries, slot)?.name?.trim();
    if (!name) return [];
    const reach = fiduciaryContactLine(findContact(estate?.fiduciaryContacts, name));
    return [{ cells: [fiduciarySlotLabel(slot), name, reach ?? DASH] }];
  });
  if (nominations.length > 0) {
    blocks.push({
      kind: "table",
      heading: "Fiduciaries",
      columns: [
        { label: "Role", flex: 1.4 },
        { label: "Name", flex: 1.4 },
        { label: "Contact", flex: 2.4 },
      ],
      rows: nominations,
    });
  }

  // The arrangement in one line, then anybody Family does not already
  // introduce — a sister, a godchild — so the name is not left unexplained.
  const summary = inheritanceSummaryLine(estate?.inheritance, family);
  const predeceased = predeceasedLabel(estate?.inheritance?.ifPredeceased);
  const inherits: AnswerField[] = [
    ...(summary ? [{ label: "Arrangement", value: summary }] : []),
    ...resolveEstateBeneficiaries(estate?.inheritance, family)
      .filter((p) => !p.fromFamily)
      .map((p) => ({
        label: p.name,
        value: detail(p.detail, sharePercentLabel(p.sharePercent)) || DASH,
      })),
    ...(predeceased ? [{ label: "If one of them dies first", value: predeceased }] : []),
  ];
  if (inherits.length > 0) blocks.push({ kind: "fields", heading: "Who inherits", fields: inherits });

  // The schedule is spelled out rather than named — "chose the suggested
  // schedule", read later with no schedule attached, records nothing.
  const distribution = estate?.childrenDistribution;
  const chosen = childDistributionLabel(distribution);
  if (estateHouseholdFromPayload(payload.family).hasChildren && chosen) {
    blocks.push({
      kind: "fields",
      heading: "How the children receive assets",
      fields: [
        {
          label: "Plan",
          value:
            distribution?.plan === "suggested" ? SUGGESTED_CHILD_DISTRIBUTION_SUMMARY : chosen,
        },
      ],
    });
    const note = distribution?.note?.trim();
    if (note) blocks.push({ kind: "quote", text: note });
  }

  return orEmpty(blocks, "No estate details entered.");
}

function documentsBlocks(documents: IntakeDocumentView[]): AnswerBlock[] {
  if (documents.length === 0) return [{ kind: "empty", text: "No documents uploaded." }];
  return [
    {
      kind: "table",
      columns: [
        { label: "File", flex: 3 },
        { label: "Type", flex: 1.6 },
        { label: "Uploaded", flex: 1.2, align: "right" },
      ],
      rows: documents.map((d) => ({
        cells: [
          d.filename,
          intakeDocTypeLabel(d.docType) ?? DASH,
          fmtDob(d.uploadedAt.slice(0, 10)) ?? DASH,
        ],
      })),
    },
  ];
}

/** Every question is listed, answered or not, so the gaps show. */
function riskBlocks(payload: IntakePayload): AnswerBlock[] {
  const rtq = summarizeRtq((payload.risk?.answers ?? {}) as Record<string, string>);
  const note = payload.risk?.environmentNote?.trim();
  if (rtq.answered === 0 && !note) return [{ kind: "empty", text: "Questionnaire not answered." }];

  const blocks: AnswerBlock[] = [
    {
      kind: "fields",
      fields: [
        {
          label: "Result",
          value:
            rtq.score === null || rtq.level === null
              ? `Partially answered — ${rtq.answered} of ${rtq.total} questions`
              : `${rtq.score} · ${RISK_LEVEL_LABELS[rtq.level]}`,
        },
      ],
    },
    {
      kind: "table",
      columns: [
        { label: "Question", flex: 3 },
        { label: "Answer", flex: 2 },
      ],
      rows: rtq.answers.map((a) => ({ cells: [a.prompt, a.label ?? DASH] })),
    },
  ];
  if (note) blocks.push({ kind: "quote", heading: "How markets feel to them", text: note });
  return blocks;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface IntakeAnswersInput {
  payload: IntakePayload;
  /** What the form collected — gates the output; the payload does not. A
   *  prefilled form seeds sections the client was never shown. */
  sections: readonly IntakeSectionKey[];
  documents: IntakeDocumentView[];
  recipientName: string | null;
  recipientEmail: string;
  sentAt: Date | null;
  submittedAt: Date;
  currentYear: number;
}

export function buildIntakeAnswersDocument(input: IntakeAnswersInput): IntakeAnswersDocument {
  const { payload, currentYear } = input;
  const collected = new Set(input.sections);

  // A total Record: a section added to `IntakeSectionKey` is a compile error
  // here until it is given a builder.
  const builders: Record<IntakeSectionKey, () => AnswerBlock[]> = {
    family: () => familyBlocks(payload),
    accounts: () => accountsBlocks(payload),
    income: () => incomeBlocks(payload, currentYear),
    property: () => propertyBlocks(payload),
    goals: () => goalsBlocks(payload, currentYear),
    estate: () => estateBlocks(payload),
    documents: () => documentsBlocks(input.documents),
    risk: () => riskBlocks(payload),
  };

  const primary = fullName(payload.family?.primary);
  const householdName = primary
    ? formatHouseholdName(primary, fullName(payload.family?.spouse ?? undefined))
    : (input.recipientName?.trim() || input.recipientEmail);

  return {
    householdName,
    completedBy: detail(input.recipientName?.trim(), input.recipientEmail),
    sentOn: input.sentAt ? longDate(input.sentAt) : null,
    submittedOn: longDate(input.submittedAt),
    sections: INTAKE_SECTIONS.filter((k) => collected.has(k)).map((key) => ({
      key,
      title: INTAKE_SECTION_LABELS[key],
      blocks: builders[key](),
    })),
  };
}

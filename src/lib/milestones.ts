export const YEAR_REFS = [
  "plan_start",
  "plan_end",
  "client_retirement",
  "spouse_retirement",
  "client_end",
  "spouse_end",
  "client_ss_62",
  "client_ss_fra",
  "client_ss_70",
  "spouse_ss_62",
  "spouse_ss_fra",
  "spouse_ss_70",
] as const;

export type YearRef = (typeof YEAR_REFS)[number];

export const YEAR_REF_LABELS: Record<YearRef, string> = {
  plan_start: "Plan Start",
  plan_end: "Plan End",
  client_retirement: "Client Retirement",
  spouse_retirement: "Spouse Retirement",
  client_end: "Client End of Plan",
  spouse_end: "Spouse End of Plan",
  client_ss_62: "Client Age 62",
  client_ss_fra: "Client FRA",
  client_ss_70: "Client Age 70",
  spouse_ss_62: "Spouse Age 62",
  spouse_ss_fra: "Spouse FRA",
  spouse_ss_70: "Spouse Age 70",
};

/** Milestones resolved from client data — computed once per page load */
export interface ClientMilestones {
  planStart: number;
  planEnd: number;
  clientRetirement: number;
  clientEnd: number;
  spouseRetirement?: number;
  spouseEnd?: number;
  clientSS62?: number;
  clientSSFRA?: number;
  clientSS70?: number;
  spouseSS62?: number;
  spouseSSFRA?: number;
  spouseSS70?: number;
}

/**
 * Build ClientMilestones from client + plan settings data.
 * FRA defaults to 67 (born 1960+).
 */
export function buildClientMilestones(client: {
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  spouseDob?: string | null;
  spouseRetirementAge?: number | null;
}, planStartYear: number, planEndYear: number): ClientMilestones {
  const clientBirthYear = new Date(client.dateOfBirth).getFullYear();

  const milestones: ClientMilestones = {
    planStart: planStartYear,
    planEnd: planEndYear,
    clientRetirement: clientBirthYear + client.retirementAge,
    clientEnd: clientBirthYear + client.planEndAge,
    clientSS62: clientBirthYear + 62,
    clientSSFRA: clientBirthYear + 67,
    clientSS70: clientBirthYear + 70,
  };

  if (client.spouseDob && client.spouseRetirementAge != null) {
    const spouseBirthYear = new Date(client.spouseDob).getFullYear();
    milestones.spouseRetirement = spouseBirthYear + client.spouseRetirementAge;
    milestones.spouseEnd = spouseBirthYear + client.planEndAge;
    milestones.spouseSS62 = spouseBirthYear + 62;
    milestones.spouseSSFRA = spouseBirthYear + 67;
    milestones.spouseSS70 = spouseBirthYear + 70;
  }

  return milestones;
}

/** Resolve a milestone ref to a year number. Returns undefined if ref requires spouse data that's missing. */
export function resolveMilestone(ref: YearRef, m: ClientMilestones): number | undefined {
  switch (ref) {
    case "plan_start": return m.planStart;
    case "plan_end": return m.planEnd;
    case "client_retirement": return m.clientRetirement;
    case "spouse_retirement": return m.spouseRetirement;
    case "client_end": return m.clientEnd;
    case "spouse_end": return m.spouseEnd;
    case "client_ss_62": return m.clientSS62;
    case "client_ss_fra": return m.clientSSFRA;
    case "client_ss_70": return m.clientSS70;
    case "spouse_ss_62": return m.spouseSS62;
    case "spouse_ss_fra": return m.spouseSSFRA;
    case "spouse_ss_70": return m.spouseSS70;
  }
}

/** Which milestone refs are available (filters out spouse refs when no spouse) */
export function availableRefs(m: ClientMilestones, includeSSRefs = false): { ref: YearRef; label: string; year: number }[] {
  const refs: { ref: YearRef; label: string; year: number }[] = [
    { ref: "plan_start", label: YEAR_REF_LABELS.plan_start, year: m.planStart },
    { ref: "plan_end", label: YEAR_REF_LABELS.plan_end, year: m.planEnd },
    { ref: "client_retirement", label: YEAR_REF_LABELS.client_retirement, year: m.clientRetirement },
    { ref: "client_end", label: YEAR_REF_LABELS.client_end, year: m.clientEnd },
  ];

  if (m.spouseRetirement != null) {
    refs.push(
      { ref: "spouse_retirement", label: YEAR_REF_LABELS.spouse_retirement, year: m.spouseRetirement },
    );
  }
  if (m.spouseEnd != null) {
    refs.push(
      { ref: "spouse_end", label: YEAR_REF_LABELS.spouse_end, year: m.spouseEnd },
    );
  }

  if (includeSSRefs) {
    if (m.clientSS62 != null) {
      refs.push(
        { ref: "client_ss_62", label: YEAR_REF_LABELS.client_ss_62, year: m.clientSS62 },
        { ref: "client_ss_fra", label: YEAR_REF_LABELS.client_ss_fra, year: m.clientSSFRA! },
        { ref: "client_ss_70", label: YEAR_REF_LABELS.client_ss_70, year: m.clientSS70! },
      );
    }
    if (m.spouseSS62 != null) {
      refs.push(
        { ref: "spouse_ss_62", label: YEAR_REF_LABELS.spouse_ss_62, year: m.spouseSS62 },
        { ref: "spouse_ss_fra", label: YEAR_REF_LABELS.spouse_ss_fra, year: m.spouseSSFRA! },
        { ref: "spouse_ss_70", label: YEAR_REF_LABELS.spouse_ss_70, year: m.spouseSS70! },
      );
    }
  }

  return refs;
}

type Owner = "client" | "spouse" | "joint";
type IncomeType = "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
type ExpenseType = "living" | "other" | "insurance";

/** Get default year refs for a new income record */
export function defaultIncomeRefs(type: IncomeType, owner: Owner): { startYearRef: YearRef | null; endYearRef: YearRef | null } {
  const retRef = owner === "spouse" ? "spouse_retirement" : "client_retirement";
  const endRef = owner === "spouse" ? "spouse_end" : "client_end";

  switch (type) {
    case "salary":
      return { startYearRef: "plan_start", endYearRef: retRef };
    case "social_security":
      // Start year comes from claimingAge, not a ref
      return { startYearRef: null, endYearRef: endRef };
    case "business":
      return { startYearRef: "plan_start", endYearRef: retRef };
    case "deferred":
      return { startYearRef: retRef, endYearRef: endRef };
    case "capital_gains":
    case "trust":
    case "other":
      return { startYearRef: "plan_start", endYearRef: "plan_end" };
  }
}

/** Get default year refs for a new expense record */
export function defaultExpenseRefs(_type: ExpenseType): { startYearRef: YearRef | null; endYearRef: YearRef | null } {
  return { startYearRef: "plan_start", endYearRef: "plan_end" };
}

/** Get default year refs for a new savings rule */
export function defaultSavingsRuleRefs(): { startYearRef: YearRef | null; endYearRef: YearRef | null } {
  return { startYearRef: "plan_start", endYearRef: "client_retirement" };
}

/** Get default year refs for a new withdrawal strategy */
export function defaultWithdrawalRefs(): { startYearRef: YearRef | null; endYearRef: YearRef | null } {
  return { startYearRef: "client_retirement", endYearRef: "plan_end" };
}

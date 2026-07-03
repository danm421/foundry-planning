//
// Pure assembly helpers for the meeting-prep battery. No DB, no auth —
// the IO loader (battery.ts) fetches rows and delegates here, so all
// window/split/portfolio logic tests in plain vitest.

export type MeetingPrepTask = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "done";
  priority: "low" | "med" | "high";
  dueDate: string | null; // YYYY-MM-DD
  completedAt: string | null; // YYYY-MM-DD
};

export type MeetingPrepAccountRow = {
  name: string;
  category: string;
  custodian: string | null;
  balance: number | null;
  balanceAsOf: string | null; // YYYY-MM-DD
};

export type MeetingPrepPortfolio = {
  source: "planning" | "crm";
  accounts: MeetingPrepAccountRow[];
  total: number;
};

export type TaskRowIn = {
  id: string;
  title: string;
  status: MeetingPrepTask["status"];
  priority: MeetingPrepTask["priority"];
  dueDate: string | null;
  completedAt: Date | null;
};

export type CrmAccountRowIn = {
  accountType: string | null;
  custodian: string | null;
  accountNumberLast4: string | null;
  balance: string | null; // numeric column
  balanceAsOf: string | null;
};

export type PlanningAccountRowIn = {
  name: string;
  category: string;
  value: string | number | null;
};

const DEFAULT_WINDOW_DAYS = 90;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function windowStartToMs(windowStartIso: string): number {
  return new Date(`${windowStartIso}T00:00:00.000Z`).getTime();
}

export function resolveWindowStart(
  lastMeetingDate: Date | null,
  override: string | null,
  now: Date,
): string {
  if (override) return override;
  if (lastMeetingDate) return toIsoDate(lastMeetingDate);
  const fallback = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return toIsoDate(fallback);
}

export function deriveLastMeetingDate(
  activity: Array<{ kind: string; occurredAt: Date }>,
): Date | null {
  let latest: Date | null = null;
  for (const a of activity) {
    if (a.kind !== "meeting" && a.kind !== "call") continue;
    if (!latest || a.occurredAt > latest) latest = a.occurredAt;
  }
  return latest;
}

export function splitTasks(
  rows: TaskRowIn[],
  windowStartIso: string,
): { outstanding: MeetingPrepTask[]; completedInWindow: MeetingPrepTask[] } {
  const windowStartMs = windowStartToMs(windowStartIso);
  const outstanding: MeetingPrepTask[] = [];
  const completedInWindow: MeetingPrepTask[] = [];
  for (const r of rows) {
    const t: MeetingPrepTask = {
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate,
      completedAt: r.completedAt ? toIsoDate(r.completedAt) : null,
    };
    if (r.status === "done") {
      if (r.completedAt && r.completedAt.getTime() >= windowStartMs) completedInWindow.push(t);
    } else {
      outstanding.push(t);
    }
  }
  return { outstanding, completedInWindow };
}

// Generic over the row type so battery-core stays free of NoteRow imports —
// anything with an ISO `occurredAt` filters the same way.
export function filterNotesInWindow<T extends { occurredAt: string }>(
  notes: T[],
  windowStartIso: string,
): T[] {
  const windowStartMs = windowStartToMs(windowStartIso);
  return notes.filter((n) => new Date(n.occurredAt).getTime() >= windowStartMs);
}

export function portfolioFromCrmAccounts(rows: CrmAccountRowIn[]): MeetingPrepPortfolio {
  const accounts = rows.map((r) => {
    const nameParts = [r.custodian, r.accountType].filter(Boolean);
    const last4 = r.accountNumberLast4 ? ` (…${r.accountNumberLast4})` : "";
    return {
      name: (nameParts.join(" ") || "Account") + last4,
      category: r.accountType ?? "Other",
      custodian: r.custodian,
      balance: r.balance != null ? Number(r.balance) : null,
      balanceAsOf: r.balanceAsOf,
    };
  });
  return {
    source: "crm",
    accounts,
    total: accounts.reduce((s, a) => s + (a.balance ?? 0), 0),
  };
}

const PLANNING_CATEGORY_LABELS: Record<string, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  roth: "Roth",
  hsa: "HSA",
  education_savings: "529 / Education",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

function planningCategoryLabel(category: string): string {
  return (
    PLANNING_CATEGORY_LABELS[category] ??
    category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function portfolioFromPlanningAccounts(
  rows: PlanningAccountRowIn[],
): MeetingPrepPortfolio {
  const accounts = rows.map((r) => ({
    name: r.name,
    category: planningCategoryLabel(r.category),
    custodian: null,
    balance: r.value != null ? Number(r.value) : null,
    balanceAsOf: null,
  }));
  return {
    source: "planning",
    accounts,
    total: accounts.reduce((s, a) => s + (a.balance ?? 0), 0),
  };
}

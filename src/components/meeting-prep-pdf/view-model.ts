// src/components/meeting-prep-pdf/view-model.ts
//
// Pure formatting layer between the battery and the PDF components. Keeps the
// documents dumb (render strings) and the formatting testable.
import type { MeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";
import type { MeetingPrepSetup } from "@/lib/crm/meeting-prep/schemas";

export type MeetingPrepPdfModel = {
  householdName: string;
  meetingDate: string; // YYYY-MM-DD
  focus: string;
  preparedBy: string | null;
  generatedAt: string; // display string
  lastMeetingDate: string | null;
  windowStart: string;
  clientSince: string;
  outstandingTasks: Array<{ title: string; priority: string; dueDate: string | null; overdue: boolean }>;
  completedTasks: Array<{ title: string; completedAt: string | null }>;
  portfolio: {
    source: "planning" | "crm";
    totalDisplay: string;
    byCategory: Array<{ category: string; totalDisplay: string }>;
    accounts: Array<{ name: string; category: string; custodian: string | null; balanceDisplay: string; balanceAsOf: string | null }>;
  };
  vitals: Array<{ label: string; value: string }>; // empty when not planning-linked
  alerts: Array<{ severity: string; title: string }>;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function money(n: number | null): string {
  return n == null ? "—" : usd.format(n);
}

export function buildMeetingPrepPdfModel(args: {
  battery: MeetingPrepBattery;
  setup: MeetingPrepSetup;
  preparedBy: string | null;
  generatedAt: string;
}): MeetingPrepPdfModel {
  const { battery, setup } = args;
  const meetingDateMs = new Date(`${setup.meetingDate}T00:00:00.000Z`).getTime();

  const byCategory = new Map<string, number>();
  for (const a of battery.portfolio.accounts) {
    byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + (a.balance ?? 0));
  }

  const vitals: Array<{ label: string; value: string }> = [];
  if (battery.vitals) {
    vitals.push({ label: "Net worth", value: money(battery.vitals.netWorth) });
    vitals.push({ label: "Liquid portfolio", value: money(battery.vitals.liquidPortfolio) });
    if (battery.vitals.yearsToRetirement != null) {
      vitals.push({ label: "Years to retirement", value: String(battery.vitals.yearsToRetirement) });
    }
    if (battery.vitals.mcSuccessRate != null) {
      vitals.push({
        label: "Monte Carlo success",
        value: `${Math.round(battery.vitals.mcSuccessRate * 100)}%`,
      });
    }
  }

  return {
    householdName: battery.household.name,
    meetingDate: setup.meetingDate,
    focus: setup.focus,
    preparedBy: args.preparedBy,
    generatedAt: args.generatedAt,
    lastMeetingDate: battery.lastMeetingDate,
    windowStart: battery.windowStart,
    clientSince: battery.household.clientSince,
    outstandingTasks: battery.outstandingTasks.map((t) => ({
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      overdue: t.dueDate != null && new Date(`${t.dueDate}T00:00:00.000Z`).getTime() < meetingDateMs,
    })),
    completedTasks: battery.completedTasks.map((t) => ({ title: t.title, completedAt: t.completedAt })),
    portfolio: {
      source: battery.portfolio.source,
      totalDisplay: money(battery.portfolio.total),
      byCategory: [...byCategory.entries()].map(([category, total]) => ({
        category,
        totalDisplay: money(total),
      })),
      accounts: battery.portfolio.accounts.map((a) => ({
        name: a.name,
        category: a.category,
        custodian: a.custodian,
        balanceDisplay: money(a.balance),
        balanceAsOf: a.balanceAsOf,
      })),
    },
    vitals,
    alerts: battery.alerts.map((a) => ({ severity: a.severity, title: a.title })),
  };
}

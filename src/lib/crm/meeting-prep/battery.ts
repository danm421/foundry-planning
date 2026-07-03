//
// IO loader for the meeting-prep battery. Performs NO auth (takes firmId
// explicitly, mirroring src/lib/crm/notes.ts) — routes gate with
// requireCrmHouseholdAccess. All decision logic lives in battery-core.ts.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, crmHouseholdAccounts, crmHouseholds, crmTasks, scenarios } from "@/db/schema";
import { listHouseholdNotes, type NoteRow } from "@/lib/crm/notes";
import { listActivity } from "@/lib/crm/activity";
import { getOverviewData } from "@/lib/overview/get-overview-data";
import { computeAlerts, type Alert } from "@/lib/alerts";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import {
  deriveLastMeetingDate,
  portfolioFromCrmAccounts,
  portfolioFromPlanningAccounts,
  resolveWindowStart,
  splitTasks,
  type MeetingPrepPortfolio,
  type MeetingPrepTask,
} from "./battery-core";

export type MeetingPrepVitals = {
  netWorth: number;
  liquidPortfolio: number;
  yearsToRetirement: number | null;
  mcSuccessRate: number | null; // [0,1] from the compute cache, null if unavailable
};

export type MeetingPrepBattery = {
  household: { id: string; name: string; clientSince: string };
  contacts: Array<{
    role: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  }>;
  windowStart: string; // YYYY-MM-DD
  lastMeetingDate: string | null; // YYYY-MM-DD
  notesInWindow: NoteRow[];
  recentNotes: NoteRow[]; // up to 25 most recent regardless of window (personal-notes mining)
  outstandingTasks: MeetingPrepTask[];
  completedTasks: MeetingPrepTask[];
  portfolio: MeetingPrepPortfolio;
  vitals: MeetingPrepVitals | null; // null when the household has no planning client
  alerts: Alert[];
};

export async function loadMeetingPrepBattery(
  householdId: string,
  firmId: string,
  opts: { windowStartOverride?: string | null } = {},
): Promise<MeetingPrepBattery> {
  // Mirrors getCrmHousehold's shape (src/lib/crm/households.ts): `contacts`
  // and `planningClient` are both declared relations on crmHouseholds, so a
  // single relational query covers both instead of a second `clients` lookup.
  const household = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, householdId), eq(crmHouseholds.firmId, firmId)),
    with: { contacts: true, planningClient: { columns: { id: true } } },
  });
  if (!household) throw new Error("Household not found in firm");

  const [notes, activity, taskRows] = await Promise.all([
    listHouseholdNotes(householdId, firmId),
    listActivity(householdId, { limit: 200 }),
    db
      .select({
        id: crmTasks.id,
        title: crmTasks.title,
        status: crmTasks.status,
        priority: crmTasks.priority,
        dueDate: crmTasks.dueDate,
        completedAt: crmTasks.completedAt,
      })
      .from(crmTasks)
      .where(and(eq(crmTasks.firmId, firmId), eq(crmTasks.householdId, householdId))),
  ]);

  const lastMeeting = deriveLastMeetingDate(activity);
  const windowStart = resolveWindowStart(lastMeeting, opts.windowStartOverride ?? null, new Date());
  const windowStartMs = new Date(`${windowStart}T00:00:00.000Z`).getTime();

  const { outstanding, completedInWindow } = splitTasks(taskRows, windowStart);

  const planningClient = household.planningClient;

  let portfolio: MeetingPrepPortfolio;
  let vitals: MeetingPrepVitals | null = null;
  let alerts: Alert[] = [];

  if (planningClient) {
    const [baseScenario] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, planningClient.id), eq(scenarios.isBaseCase, true)))
      .limit(1);
    const accountRows = baseScenario
      ? await db
          .select({ name: accounts.name, category: accounts.category, value: accounts.value })
          .from(accounts)
          .where(and(eq(accounts.clientId, planningClient.id), eq(accounts.scenarioId, baseScenario.id)))
      : [];
    portfolio = portfolioFromPlanningAccounts(accountRows);

    const overview = await getOverviewData(planningClient.id, firmId, "base");
    // MC from the compute cache: computed+stored on miss elsewhere; a failure
    // here (cold client, projection error) is non-fatal — vitals row hides it.
    let mcSuccessRate: number | null = null;
    try {
      const mc = await getOrComputeMonteCarlo({
        clientId: planningClient.id,
        firmId,
        scenarioId: "base",
      });
      mcSuccessRate = mc.payload.summary.successRate;
    } catch {
      mcSuccessRate = null;
    }
    vitals = {
      netWorth: overview.kpi.netWorth,
      liquidPortfolio: overview.kpi.liquidPortfolio,
      yearsToRetirement: overview.kpi.yearsToRetirement,
      mcSuccessRate,
    };
    alerts = computeAlerts(overview.client, {
      monteCarloSuccess: mcSuccessRate,
      liquidPortfolio: overview.alertInputs.liquidPortfolio,
      currentYearNetOutflow: overview.alertInputs.currentYearNetOutflow,
      minNetWorth: overview.alertInputs.minNetWorth,
    });
  } else {
    const crmAccounts = await db
      .select({
        accountType: crmHouseholdAccounts.accountType,
        custodian: crmHouseholdAccounts.custodian,
        accountNumberLast4: crmHouseholdAccounts.accountNumberLast4,
        balance: crmHouseholdAccounts.balance,
        balanceAsOf: crmHouseholdAccounts.balanceAsOf,
      })
      .from(crmHouseholdAccounts)
      .where(eq(crmHouseholdAccounts.householdId, householdId));
    portfolio = portfolioFromCrmAccounts(crmAccounts);
  }

  return {
    household: {
      id: household.id,
      name: household.name,
      clientSince: household.createdAt.toISOString().slice(0, 10),
    },
    contacts: (household.contacts ?? []).map((c) => ({
      role: c.role,
      firstName: c.firstName,
      lastName: c.lastName,
      dateOfBirth: c.dateOfBirth,
    })),
    windowStart,
    lastMeetingDate: lastMeeting ? lastMeeting.toISOString().slice(0, 10) : null,
    notesInWindow: notes.filter((n) => new Date(n.occurredAt).getTime() >= windowStartMs),
    recentNotes: notes.slice(0, 25),
    outstandingTasks: outstanding,
    completedTasks: completedInWindow,
    portfolio,
    vitals,
    alerts,
  };
}

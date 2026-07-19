"use client";

import { useState } from "react";
import Link from "next/link";
import type { getCrmHousehold } from "@/lib/crm/households";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";
import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { FirmMember } from "@/lib/crm-tasks/members";
import type { TaskDetailBundle } from "@/app/(app)/tasks/_components/tasks-page";
import { HouseholdTrashActions } from "@/components/household-trash-actions";
import { OverviewTab } from "./tabs/overview-tab";
import { ContactsTab } from "./tabs/contacts-tab";
import { AccountsTab } from "./tabs/accounts-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { TasksTab } from "./tabs/tasks-tab";
import { NotesTab } from "./tabs/notes-tab";
import { InsightsTab } from "./tabs/insights/insights-tab";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

// "insights" (the 360 AI tab) is only shown when the household has a linked
// planning client — its data is derived entirely from plan projections.
const ALL_TABS = [
  "overview",
  "insights",
  "contacts",
  "accounts",
  "activity",
  "documents",
  "tasks",
  "notes",
] as const;
type Tab = (typeof ALL_TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  insights: "360 AI",
  contacts: "Contacts",
  accounts: "Accounts",
  activity: "Activity",
  documents: "Documents",
  tasks: "Tasks",
  notes: "Notes",
};

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export interface HouseholdDetailTasksBootstrap {
  initialRows: TaskListRow[];
  members: FirmMember[];
  firmTags: { id: string; label: string; color: string }[];
  households: { id: string; name: string }[];
  initialTaskDetail: TaskDetailBundle | null;
}

export function HouseholdDetail({
  household,
  advisorName,
  initialTab,
  initialTaskId,
  tasksBootstrap,
  canManage,
  relationships,
}: {
  household: Household;
  advisorName: string;
  initialTab: string;
  initialTaskId?: string;
  tasksBootstrap: HouseholdDetailTasksBootstrap;
  canManage: boolean;
  relationships: HouseholdRelationshipView[];
}) {
  const planningClientId = household.planningClient?.id ?? null;
  const tabs: Tab[] = ALL_TABS.filter((t) => t !== "insights" || planningClientId !== null);

  const [tab, setTab] = useState<Tab>(
    tabs.includes(initialTab as Tab) ? (initialTab as Tab) : "overview",
  );

  const planningHref = planningClientId
    ? `/clients/${planningClientId}/details`
    : `/clients/new?crmHouseholdId=${household.id}`;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{household.name}</h1>
          <div className="mt-1 text-sm text-ink-3">
            Status: {STATUS_LABELS[household.status] ?? household.status}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!household.deletedAt && (
            <Link
              href={`/crm/households/${household.id}/meeting-prep`}
              className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-card-2"
            >
              Meeting Prep
            </Link>
          )}
          <Link
            href={planningHref}
            className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink"
          >
            {household.planningClient ? "Access planning" : "Start planning"}
          </Link>
          {canManage && (
            <HouseholdTrashActions
              householdId={household.id}
              householdName={household.name}
              deleted={Boolean(household.deletedAt)}
            />
          )}
        </div>
      </div>

      {household.deletedAt && (
        <div className="mt-4 rounded-lg border border-hair bg-card-2 px-4 py-3 text-sm text-ink-2">
          This household is in the Trash. Use the ⋯ menu to restore it or delete it permanently.
        </div>
      )}

      <div role="tablist" className="mt-6 flex gap-0.5 border-b border-hair">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "cursor-pointer border-b-2 border-accent px-4 py-2.5 text-sm font-medium text-accent transition-colors duration-150"
                : "cursor-pointer border-b-2 border-transparent px-4 py-2.5 text-sm text-ink-3 transition-colors duration-150 hover:text-ink-2"
            }
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "overview" && (
          <OverviewTab household={household} advisorName={advisorName} relationships={relationships} />
        )}
        {tab === "insights" && planningClientId && (
          <InsightsTab clientId={planningClientId} />
        )}
        {tab === "contacts" && (
          <ContactsTab household={household} relationships={relationships} />
        )}
        {tab === "accounts" && <AccountsTab household={household} />}
        {tab === "activity" && <ActivityTab household={household} />}
        {tab === "documents" && <DocumentsTab household={household} />}
        {tab === "tasks" && (
          <TasksTab
            household={{ id: household.id, name: household.name }}
            initialTaskId={initialTaskId}
            initialRows={tasksBootstrap.initialRows}
            members={tasksBootstrap.members}
            firmTags={tasksBootstrap.firmTags}
            households={tasksBootstrap.households}
            initialTaskDetail={tasksBootstrap.initialTaskDetail}
          />
        )}
        {tab === "notes" && <NotesTab household={household} />}
      </div>
    </div>
  );
}

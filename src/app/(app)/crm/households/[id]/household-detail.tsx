"use client";

import { useState } from "react";
import Link from "next/link";
import type { getCrmHousehold } from "@/lib/crm/households";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";
import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { FirmMember } from "@/lib/crm-tasks/members";
import type { TaskDetailBundle } from "@/app/(app)/tasks/_components/tasks-page";
import { HouseholdTrashActions } from "@/components/household-trash-actions";
import {
  SectionLabel,
  chipAccentClass,
  primaryButtonClass,
} from "@/components/crm-section-primitives";
import { OverviewTab } from "./tabs/overview-tab";
import { ContactsTab } from "./tabs/contacts-tab";
import { AccountsTab } from "./tabs/accounts-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { TasksTab } from "./tabs/tasks-tab";
import { NotesTab } from "./tabs/notes-tab";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

// The 360 AI panel used to be its own "insights" tab. It now lives at the top
// of Overview (see `overview-tab.tsx`), so `?tab=insights` deep links fall
// through the `tabs.includes` guard below and land on Overview — which is
// where that content now is.
const ALL_TABS = [
  "overview",
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
  const tabs: Tab[] = [...ALL_TABS];

  const [tab, setTab] = useState<Tab>(
    tabs.includes(initialTab as Tab) ? (initialTab as Tab) : "overview",
  );

  const planningHref = planningClientId
    ? `/clients/${planningClientId}/details`
    : `/clients/new?crmHouseholdId=${household.id}`;

  return (
    <div className="px-6 pb-10 pt-5 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <SectionLabel as="div" segments={["CRM", "Household record"]} />
          <h1 className="mt-3 font-display text-[clamp(30px,5vw,52px)] leading-[0.94] tracking-[-0.045em] text-ink [text-wrap:pretty]">
            {household.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            <span className={chipAccentClass}>
              {STATUS_LABELS[household.status] ?? household.status}
            </span>
            <span aria-hidden="true" className="text-ink-4">
              /
            </span>
            <span className="tabular normal-case tracking-[0.06em]">{household.id}</span>
            <span aria-hidden="true" className="text-ink-4">
              /
            </span>
            <span>{advisorName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!household.deletedAt && (
            <Link
              href={`/crm/households/${household.id}/meeting-prep`}
              className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-hair-2 px-3.5 py-2 text-[13px] font-semibold text-ink transition-colors duration-150 hover:bg-card-hover"
            >
              Meeting Prep
            </Link>
          )}
          <Link href={planningHref} className={primaryButtonClass}>
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
        <div className="mt-5 rounded-[var(--radius-md)] border border-hair-2 bg-card px-4 py-3 text-[13px] text-ink-2">
          This household is in the Trash. Use the ⋯ menu to restore it or delete it permanently.
        </div>
      )}

      <div
        role="tablist"
        className="mt-6 flex gap-0 overflow-x-auto border-b border-hair [scrollbar-width:none]"
      >
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "-mb-px shrink-0 cursor-pointer border-b-2 border-accent px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors duration-150"
                : "-mb-px shrink-0 cursor-pointer border-b-2 border-transparent px-4 py-2.5 text-[13px] font-medium text-ink-3 transition-colors duration-150 hover:text-ink-2"
            }
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "overview" && (
          <OverviewTab
            household={household}
            advisorName={advisorName}
            relationships={relationships}
            planningClientId={planningClientId}
          />
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

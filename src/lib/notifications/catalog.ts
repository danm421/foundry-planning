// src/lib/notifications/catalog.ts
//
// The closed vocabulary for advisor notifications, plus everything derived
// from it. Pure — no imports, no IO — so it can be unit-tested and imported
// from both server and client components.
//
// NOTE ON NAMING: the user-facing label for all of this is "Alerts" (sidebar
// entry, page heading, /alerts route). The CODE says "notifications" because
// src/lib/alerts.ts already exists and means something else entirely —
// computed plan-health warnings (Monte Carlo below threshold, liquidity
// runway, stale data). Two `Alert` types in one codebase would be a
// permanent source of confusion. See the spec's Architecture note.

/**
 * `category` is a TEXT column, not a pg enum, on purpose. An enum pushes every
 * future category through `ALTER TYPE ... ADD VALUE`, which drizzle-kit runs
 * inside the single migration transaction and which throws PG 55P04 the moment
 * the new value is also USED in that same migration. This list will grow —
 * six more categories are already identified — so the closed vocabulary is
 * enforced here in TypeScript and at the `enqueueNotifications` chokepoint.
 */
export const NOTIFICATION_CATEGORIES = [
  // Client actions — the client did something and you were not watching
  "intake_opened",
  "intake_submitted",
  "document_uploaded",
  "rtq_submitted",
  "portal_first_login",
  "portal_data_edited",
  // Risk
  "risk_level_changed",
  "risk_constraint_binding",
  "risk_review_due",
  // Dates — materialized by the scan cron, not by a write-site producer
  "client_birthday",
  "client_milestone_age",
  // CRM tasks
  "task_assigned",
  "task_mentioned",
  "task_commented",
  "task_due_soon",
  // Data plumbing
  "plaid_reconnect_needed",
  "integration_sync_failed",
  "import_extraction_ready",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(v: string): v is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(v);
}

/** Per-channel on/off for one category. */
export type NotificationChannelPref = { inApp: boolean; email: boolean };

export type NotificationPrefsMap = Record<NotificationCategory, NotificationChannelPref>;

/**
 * In-app ON everywhere, email OFF everywhere — v1 is pure opt-in.
 *
 * Nobody receives notification mail until they turn a category on themselves
 * on /alerts. Email is the only channel that leaves the app and lands in a
 * real inbox: an unwanted in-app row is ignored, an unwanted email trains
 * people to filter us out.
 *
 * A new category MUST ship with `email: false`. Shipping one `true` would
 * start mailing every advisor the moment it deploys, with no action on their
 * part — catalog.test.ts asserts this against EMAIL_ON_BY_DEFAULT in both
 * directions, so it cannot slip through review by accident.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsMap = {
  intake_opened: { inApp: true, email: false },
  intake_submitted: { inApp: true, email: false },
  document_uploaded: { inApp: true, email: false },
  rtq_submitted: { inApp: true, email: false },
  portal_first_login: { inApp: true, email: false },
  portal_data_edited: { inApp: true, email: false },
  risk_level_changed: { inApp: true, email: false },
  risk_constraint_binding: { inApp: true, email: false },
  risk_review_due: { inApp: true, email: false },
  client_birthday: { inApp: true, email: false },
  client_milestone_age: { inApp: true, email: false },
  task_assigned: { inApp: true, email: false },
  task_mentioned: { inApp: true, email: false },
  task_commented: { inApp: true, email: false },
  task_due_soon: { inApp: true, email: false },
  plaid_reconnect_needed: { inApp: true, email: false },
  integration_sync_failed: { inApp: true, email: false },
  import_extraction_ready: { inApp: true, email: false },
};

/**
 * Categories that deliberately default to email ON. EMPTY in v1 — every
 * category is opt-in. This is the review gate: catalog.test.ts asserts
 * DEFAULT_NOTIFICATION_PREFS agrees with this list in BOTH directions, so
 * flipping a default without adding it here fails, and adding a category here
 * without flipping its default fails too.
 */
export const EMAIL_ON_BY_DEFAULT: readonly NotificationCategory[] = [];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  intake_opened: "Client opened their intake form",
  intake_submitted: "Client submitted their intake form",
  document_uploaded: "Client uploaded a document",
  rtq_submitted: "Client completed the risk questionnaire",
  portal_first_login: "Client activated their portal account",
  portal_data_edited: "Client edited their own data",
  risk_level_changed: "Risk level changed",
  risk_constraint_binding: "Plan demands more growth than capacity allows",
  risk_review_due: "Suitability review due",
  client_birthday: "Client birthdays",
  client_milestone_age: "Planning milestone ages (59½, 65, 73…)",
  task_assigned: "Task assigned to me",
  task_mentioned: "I was @mentioned",
  task_commented: "Comment on a task I follow",
  task_due_soon: "Task due soon or overdue",
  plaid_reconnect_needed: "Bank connection needs reconnecting",
  integration_sync_failed: "Integration sync failed",
  import_extraction_ready: "Document extraction ready for review",
};

export type NotificationGroupId =
  | "client_actions"
  | "risk"
  | "dates"
  | "tasks"
  | "data";

export type NotificationGroup = {
  id: NotificationGroupId;
  label: string;
  description: string;
  categories: NotificationCategory[];
};

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    id: "client_actions",
    label: "Client actions",
    description: "Things your clients do in the portal and in forms you send them.",
    categories: [
      "intake_opened",
      "intake_submitted",
      "document_uploaded",
      "rtq_submitted",
      "portal_first_login",
      "portal_data_edited",
    ],
  },
  {
    id: "risk",
    label: "Risk",
    description: "Changes to a household's suitability picture.",
    categories: ["risk_level_changed", "risk_constraint_binding", "risk_review_due"],
  },
  {
    id: "dates",
    label: "Dates",
    description: "Birthdays and planning milestone ages across your book.",
    categories: ["client_birthday", "client_milestone_age"],
  },
  {
    id: "tasks",
    label: "CRM tasks",
    description: "Assignments, mentions, comments, and due dates.",
    categories: ["task_assigned", "task_mentioned", "task_commented", "task_due_soon"],
  },
  {
    id: "data",
    label: "Data",
    description: "Bank connections, integrations, and document imports.",
    categories: [
      "plaid_reconnect_needed",
      "integration_sync_failed",
      "import_extraction_ready",
    ],
  },
];

/**
 * Categories per group, DERIVED from NOTIFICATION_GROUPS. Never hand-list ids
 * here: ethos hand-wrote the equivalent union and silently dropped an entire
 * group when one was added, so that group's tab vanished from the UI with no
 * error anywhere.
 */
export const GROUP_CATEGORIES: Record<NotificationGroupId, NotificationCategory[]> =
  Object.fromEntries(NOTIFICATION_GROUPS.map((g) => [g.id, g.categories])) as Record<
    NotificationGroupId,
    NotificationCategory[]
  >;

export type NotificationFilter = "all" | "unread" | NotificationGroupId;

/** The Inbox tab's chips: two built-ins plus one per group, derived. */
export const NOTIFICATION_FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  ...NOTIFICATION_GROUPS.map((g) => ({ id: g.id as NotificationFilter, label: g.label })),
];

export function isNotificationFilter(v: string | undefined): v is NotificationFilter {
  return NOTIFICATION_FILTERS.some((f) => f.id === v);
}

/** Cadence for the Dates group only. Governs birthdays and milestones together. */
export const DATE_DIGEST_CADENCES = ["daily", "weekly", "monthly"] as const;
export type DateDigestCadence = (typeof DATE_DIGEST_CADENCES)[number];
export const DEFAULT_DATE_DIGEST_CADENCE: DateDigestCadence = "weekly";

/**
 * The categories the scan cron materializes rather than a write-site producer.
 * The digest renders these in their own leading section.
 */
export const DATE_CATEGORIES: NotificationCategory[] = [
  "client_birthday",
  "client_milestone_age",
];

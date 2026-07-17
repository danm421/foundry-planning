export type FeedItemKind =
  | "task-due"
  | "birthday"
  | "milestone"
  | "mention"
  | "intake-submitted"
  | "import-committed";

/** Kinds that render in the "Coming up" group; everything else is "Recent". */
export const COMING_UP_KINDS: ReadonlySet<FeedItemKind> = new Set([
  "task-due",
  "birthday",
  "milestone",
]);

export interface FeedItem {
  /** Stable unique key, e.g. `task:<uuid>` or `milestone:<contactId>:73`. */
  id: string;
  kind: FeedItemKind;
  title: string;
  subtitle: string | null;
  href: string;
  /** Event date: due date / birthday / milestone date / occurred-at. */
  when: Date;
  /** task-due only: dueDate < today. */
  overdue?: boolean;
}

export interface HomeFeed {
  comingUp: FeedItem[];
  recent: FeedItem[];
}

export interface BookKpis {
  totalBookValue: number;
  /** AUM-eligible accounts the advisor has NOT flagged as counting toward AUM. */
  assetsHeldAway: number;
  /** How many accounts make up `assetsHeldAway`. */
  heldAwayAccounts: number;
  activeHouseholds: number;
  prospectHouseholds: number;
  planningClients: number;
  tasksDueThisWeek: number;
  tasksDueThisWeekMine: number;
}

export interface RecentHousehold {
  id: string;
  name: string;
  status: string;
  hasPlanningClient: boolean;
  lastOpenedAt: Date | null;
}

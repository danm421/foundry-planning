import type {
  ComparisonLayout,
  ComparisonLayoutItem,
  ComparisonLayoutV4,
  Row,
  Cell,
  WidgetInstance,
} from "./layout-schema";

const newId = (): string => globalThis.crypto.randomUUID();

export interface MigrationContext {
  primaryScenarioId: string;
  /** Plans from the page-level `?plans=` query param at the time of migration.
   *  When non-null and non-empty, becomes the default planIds for every multi-plan widget. */
  urlPlanIds: string[] | null;
  /** Optional human title for the migrated layout. Falls back to "Comparison Report". */
  defaultTitle?: string;
}

const DEFAULT_KPI_METRICS = [
  "successProbability",
  "longevityAge",
  "endNetWorth",
  "lifetimeTax",
  "netToHeirs",
] as const;

const MAX_KPI_CELLS = 5;

function planIdsFor(ctx: MigrationContext): string[] {
  return ctx.urlPlanIds && ctx.urlPlanIds.length > 0
    ? [...ctx.urlPlanIds]
    : [ctx.primaryScenarioId];
}

function buildWidget(
  item: ComparisonLayoutItem,
  ctx: MigrationContext,
  yearRange: ComparisonLayout["yearRange"],
): WidgetInstance {
  const base: WidgetInstance = {
    id: item.instanceId,
    kind: item.kind,
    planIds: item.kind === "text" ? [] : planIdsFor(ctx),
  };
  if (item.kind !== "text" && yearRange) {
    base.yearRange = yearRange;
  }
  if (item.config !== undefined) {
    base.config = item.config;
  }
  return base;
}

function cellOf(widget: WidgetInstance): Cell {
  return { id: newId(), widget };
}

function rowOf(cells: Cell[]): Row {
  return { id: newId(), cells };
}

function expandKpiStrip(
  item: ComparisonLayoutItem,
  ctx: MigrationContext,
  yearRange: ComparisonLayout["yearRange"],
): Row {
  const config = item.config as { metrics?: string[] } | undefined;
  const requested = config?.metrics ?? DEFAULT_KPI_METRICS;
  const metrics = requested.slice(0, MAX_KPI_CELLS);

  const cells: Cell[] = metrics.map((metric) => {
    const widget: WidgetInstance = {
      id: newId(),
      kind: "kpi",
      planIds: planIdsFor(ctx),
      config: { metric },
    };
    if (yearRange) widget.yearRange = yearRange;
    return cellOf(widget);
  });

  return rowOf(cells);
}

export function migrateV3ToV4(
  v3: ComparisonLayout,
  ctx: MigrationContext,
): ComparisonLayoutV4 {
  const rows: Row[] = v3.items.map((item) => {
    if (item.kind === "kpi-strip") {
      return expandKpiStrip(item, ctx, v3.yearRange);
    }
    const widget = buildWidget(item, ctx, v3.yearRange);
    return rowOf([cellOf(widget)]);
  });
  return {
    version: 4,
    title: ctx.defaultTitle ?? "Comparison Report",
    rows,
  };
}

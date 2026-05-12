import type {
  Cell,
  ComparisonLayoutV4,
  ComparisonWidgetKindV4,
  Row,
  WidgetInstance,
} from "../layout-schema";

export interface DefaultLayoutContext {
  primaryScenarioId: string;
}

const newId = (): string => globalThis.crypto.randomUUID();

const KPI_METRICS = [
  "successProbability",
  "longevityAge",
  "endNetWorth",
  "lifetimeTax",
  "netToHeirs",
] as const;

function widget(
  kind: ComparisonWidgetKindV4,
  ctx: DefaultLayoutContext,
  config?: Record<string, unknown>,
): WidgetInstance {
  const base: WidgetInstance = {
    id: newId(),
    kind,
    planIds: [ctx.primaryScenarioId],
  };
  if (config !== undefined) base.config = config;
  return base;
}

function cellOf(w: WidgetInstance): Cell {
  return { id: newId(), widget: w };
}

function rowOf(cells: Cell[]): Row {
  return { id: newId(), cells };
}

export function getDefaultLayoutV4(ctx: DefaultLayoutContext): ComparisonLayoutV4 {
  return {
    version: 4,
    title: "Comparison Report",
    rows: [
      rowOf(KPI_METRICS.map((metric) => cellOf(widget("kpi", ctx, { metric })))),
      rowOf([cellOf(widget("income-expense", ctx))]),
      rowOf([
        cellOf(widget("monte-carlo", ctx)),
        cellOf(widget("longevity", ctx)),
      ]),
      rowOf([cellOf(widget("portfolio", ctx))]),
      rowOf([cellOf(widget("allocation-drift", ctx))]),
    ],
  };
}

// Renderer-agnostic chart description. PDF and (future) DOCX adapters both
// consume this shape. All theme tokens are resolved to hex strings before
// emission — the spec is self-contained.

export interface ChartSpec {
  kind: "stackedBarWithLine";
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };

  xAxis: {
    domain: number[];                        // year values
    ticks: number[];                         // subset to label
    labelFormat: (v: number) => string;
  };

  yAxis: {
    domain: [number, number];
    ticks: number[];
    labelFormat: (v: number) => string;
    gridlineColor: string;
  };

  stacks: Array<{
    seriesId: "salary" | "ss" | "otherIncome" | "rmd" | "withdrawals";
    label: string;
    color: string;                           // resolved hex
    values: number[];                        // one per domain entry
  }>;

  lines: Array<{
    seriesId: "totalExpenses";
    label: string;
    color: string;
    strokeWidth: number;
    values: number[];
  }>;

  markers: Array<{
    atX: number;                             // year
    label: string;
    color: string;
    iconKind: "retirement" | "endOfLife";
  }>;

  legend: {
    position: "bottom";
    items: Array<{ label: string; color: string; kind: "swatch" | "line" }>;
  };
}

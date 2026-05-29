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

  // seriesId is just a render key; drill pages emit drill-specific ids
  // (e.g. "income.salaries", "expenses.living") so a chart with arbitrary
  // stacks/lines can reuse the same renderer.
  stacks: Array<{
    seriesId: string;
    label: string;
    color: string;                           // resolved hex
    values: number[];                        // one per domain entry
  }>;

  lines: Array<{
    seriesId: string;
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

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  /** 0..1 share of the ring (precomputed). */
  fraction: number;
}

export interface DonutSpec {
  kind: "donut";
  size: number; // square viewport in pt
  /** One ring (single view) or two (combined: [inner types, outer classes]). */
  rings: { segments: DonutSegment[] }[];
  centerLabel?: string;
  centerSubLabel?: string;
  legend: { label: string; color: string; pct: number }[];
}

export interface ScatterPoint {
  key: string;
  label: string;
  x: number; // std dev (0..1)
  y: number; // arithmetic mean (0..1)
  color: string;
  pointStyle: "circle" | "rect" | "triangle" | "rectRot" | "star";
}

export interface ScatterSpec {
  kind: "scatter";
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  gridlineColor: string;
  xAxis: { domain: [number, number]; ticks: number[]; labelFormat: (v: number) => string; title: string };
  yAxis: { domain: [number, number]; ticks: number[]; labelFormat: (v: number) => string; title: string };
  points: ScatterPoint[];
  legend: { items: { label: string; color: string; pointStyle: ScatterPoint["pointStyle"] }[] };
}

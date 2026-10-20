import { layouts, type ChartType, type LayoutItem, type Plugin } from "chart.js";
import type { LifeEventMarker } from "@/lib/life-event-markers";

// Retirement and life-expectancy markers for the cash-flow and portfolio
// charts. Each person gets their own row between the legend and the plot —
// their name in the y-axis gutter, then a dot and a short "Retires" / "Passes"
// tag at each event's year — and a thin dashed line drops through the plot at
// that year. One row per person keeps spouses whose events land a year or two
// apart from printing over each other. Pass the plugin to the chart and enable
// it via:
//   options.plugins.timelineMarkers = { markers: LifeEventMarker[] }

interface TimelineMarkersOptions {
  markers?: LifeEventMarker[];
}

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    timelineMarkers?: TimelineMarkersOptions;
  }
}

const ROW_HEIGHT = 16;
const ROWS_GAP_BELOW = 6;
const DOT_RADIUS = 3;
const DOT_TEXT_GAP = 5;
const TAG_GAP = 8;
const FONT = "10px ui-sans-serif, system-ui, sans-serif";
const PERSON_ORDER = ["client", "spouse"] as const;
const TAG_TEXT = { retires: "Retires", passes: "Passes" } as const;

const peopleIn = (markers: LifeEventMarker[]) =>
  PERSON_ORDER.filter((p) => markers.some((m) => m.person === p));

/** `text`, cut with an ellipsis to fit `maxWidth` (a long name in a narrow gutter). */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** The rows' layout box. Weight 0 sits closest to the plot (below the legend),
 *  so Chart.js reserves the rows' height before it sizes the chart area. */
function rowsBox(): LayoutItem {
  return {
    position: "top",
    weight: 0,
    fullSize: true,
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    // @ts-expect-error -- Chart.js's layout reads `box.options.stack`; LayoutItem omits it.
    options: {},
    isHorizontal: () => true,
    update(width) {
      this.width = width;
    },
    draw() {},
  };
}

const rowsBoxes = new WeakMap<object, LayoutItem>();

export const timelineMarkersPlugin: Plugin<ChartType, TimelineMarkersOptions> = {
  id: "timelineMarkers",
  beforeLayout(chart, _args, options) {
    const rows = peopleIn(options.markers ?? []).length;
    let box = rowsBoxes.get(chart);
    if (!box && rows === 0) return;
    if (!box) {
      box = rowsBox();
      layouts.addBox(chart, box);
      rowsBoxes.set(chart, box);
    }
    box.height = rows > 0 ? rows * ROW_HEIGHT + ROWS_GAP_BELOW : 0;
  },
  afterDatasetsDraw(chart, _args, options) {
    const markers = options.markers ?? [];
    const box = rowsBoxes.get(chart);
    if (markers.length === 0 || !box) return;
    const { ctx, chartArea, scales } = chart;
    const xOf = (m: LifeEventMarker) => scales.x.getPixelForValue(m.yearIndex);
    const tickColor = chart.options.scales?.x?.ticks?.color;
    const textColor = typeof tickColor === "string" ? tickColor : String(chart.options.color);
    ctx.save();

    // Lines. Same-year events (both spouses retire) share an x, so their dashes
    // interleave — each color shows instead of the last one drawn hiding the rest.
    const perYear = new Map<number, number>();
    for (const m of markers) perYear.set(m.yearIndex, (perYear.get(m.yearIndex) ?? 0) + 1);
    const drawn = new Map<number, number>();
    ctx.lineWidth = 1;
    for (const m of markers) {
      const sameYear = perYear.get(m.yearIndex)!;
      const nth = drawn.get(m.yearIndex) ?? 0;
      drawn.set(m.yearIndex, nth + 1);
      const x = Math.round(xOf(m)) + 0.5;
      ctx.strokeStyle = m.color;
      ctx.setLineDash([3, 4 * sameYear - 3]);
      ctx.lineDashOffset = -4 * nth;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Rows: the person's name in the gutter, then a dot + tag per event. A tag
    // sits right of its dot, flipping left at the canvas edge (a final-year
    // death), and is nudged right of the previous tag if the two would touch.
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    peopleIn(markers).forEach((person, row) => {
      const y = box.top + row * ROW_HEIGHT + ROW_HEIGHT / 2;
      const own = markers.filter((m) => m.person === person).sort((a, b) => a.yearIndex - b.yearIndex);
      ctx.textAlign = "right";
      ctx.fillStyle = own[0].color;
      ctx.fillText(fitText(ctx, own[0].name, chartArea.left - 10), chartArea.left - 8, y);
      ctx.textAlign = "left";
      let prevRight = -Infinity;
      for (const m of own) {
        const x = xOf(m);
        const text = TAG_TEXT[m.kind];
        const width = ctx.measureText(text).width;
        let left = x + DOT_RADIUS + DOT_TEXT_GAP;
        if (left + width > chart.width - 2) left = x - DOT_RADIUS - DOT_TEXT_GAP - width;
        left = Math.max(left, prevRight + TAG_GAP);
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.fillText(text, left, y);
        prevRight = Math.max(left + width, x + DOT_RADIUS);
      }
    });
    ctx.restore();
  },
};

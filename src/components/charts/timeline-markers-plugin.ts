import { layouts, type Chart, type ChartType, type LayoutItem, type Plugin } from "chart.js";
import type { LifeEventMarker } from "@/lib/life-event-markers";

// Retirement and life-expectancy markers for the cash-flow and portfolio
// charts. Each person gets their own row between the legend and the plot —
// their name in the y-axis gutter, then a dot and a short "Retires" / "Passes"
// tag at each event's year — and a thin dashed line drops through the plot at
// that year. One row per person keeps spouses whose events land a year or two
// apart from printing over each other. Everything is drawn in the x-axis tick
// grey so the markers never read as a data series; hovering a dot or its tag
// shows what the event is. Pass the plugin to the chart and enable it via:
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
const TIP_PAD = 6;
const TIP_LINE = 16;
const TIP_TITLE_FONT = "bold 12px ui-sans-serif, system-ui, sans-serif";
const TIP_BODY_FONT = "12px ui-sans-serif, system-ui, sans-serif";

/** A drawn dot and its tag, kept so a hover can find the event under the pointer. */
interface DotHit {
  marker: LifeEventMarker;
  x: number;
  y: number;
  left: number;
  right: number;
}

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
const dotHits = new WeakMap<object, DotHit[]>();
const pointers = new WeakMap<object, { x: number; y: number } | null>();

const hitAt = (chart: object, p: { x: number; y: number } | null | undefined) =>
  p
    ? dotHits.get(chart)?.find(
        (h) => p.x >= h.left && p.x <= h.right && Math.abs(p.y - h.y) <= ROW_HEIGHT / 2,
      )
    : undefined;

const stringOr = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

/** Markers draw in the x-axis tick grey. */
const markerColor = (chart: Chart) => stringOr(chart.options.scales?.x?.ticks?.color, String(chart.options.color));

/** The hover box under a dot, styled from the chart's own tooltip colors. */
function drawTooltip(chart: Chart, { marker, x, y }: DotHit) {
  const { ctx } = chart;
  const textColor = markerColor(chart);
  const tip = chart.options.plugins?.tooltip;
  const title = marker.kind === "retires" ? `${marker.name} retires` : `${marker.name}'s life expectancy`;
  const body = `${marker.year} · age ${marker.age}`;
  ctx.save();
  ctx.font = TIP_TITLE_FONT;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = TIP_BODY_FONT;
  const width = Math.max(titleWidth, ctx.measureText(body).width) + TIP_PAD * 2;
  const height = TIP_LINE * 2 + TIP_PAD * 2;
  const left = Math.max(2, Math.min(x - width / 2, chart.width - width - 2));
  const top = y + ROW_HEIGHT / 2 + 2;
  ctx.fillStyle = stringOr(tip?.backgroundColor, "rgba(0, 0, 0, 0.8)");
  ctx.strokeStyle = stringOr(chart.options.scales?.x?.grid?.color, textColor);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left + 0.5, top + 0.5, width, height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = TIP_TITLE_FONT;
  ctx.fillStyle = stringOr(tip?.titleColor, textColor);
  ctx.fillText(title, left + TIP_PAD, top + TIP_PAD + TIP_LINE / 2);
  ctx.font = TIP_BODY_FONT;
  ctx.fillStyle = stringOr(tip?.bodyColor, textColor);
  ctx.fillText(body, left + TIP_PAD, top + TIP_PAD + TIP_LINE * 1.5);
  ctx.restore();
}

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
    dotHits.delete(chart);
    const markers = options.markers ?? [];
    const box = rowsBoxes.get(chart);
    if (markers.length === 0 || !box) return;
    const { ctx, chartArea, scales } = chart;
    const xOf = (m: LifeEventMarker) => scales.x.getPixelForValue(m.yearIndex);
    const color = markerColor(chart);
    const hits: DotHit[] = [];
    ctx.save();

    // Lines — one per year, since same-year events (both spouses retire) share an x.
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 4]);
    for (const yearIndex of new Set(markers.map((m) => m.yearIndex))) {
      const x = Math.round(scales.x.getPixelForValue(yearIndex)) + 0.5;
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
      ctx.fillStyle = color;
      ctx.textAlign = "right";
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
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(text, left, y);
        prevRight = Math.max(left + width, x + DOT_RADIUS);
        hits.push({ marker: m, x, y, left: Math.min(left, x - DOT_RADIUS), right: prevRight });
      }
    });
    ctx.restore();
    dotHits.set(chart, hits);
  },
  // Track the pointer; redraw only when it moves onto or off an event.
  afterEvent(chart, args) {
    const { event } = args;
    const pointer =
      event.type === "mouseout" || event.x == null || event.y == null ? null : { x: event.x, y: event.y };
    if (hitAt(chart, pointer) !== hitAt(chart, pointers.get(chart))) args.changed = true;
    pointers.set(chart, pointer);
  },
  afterDraw(chart) {
    const hit = hitAt(chart, pointers.get(chart));
    if (hit) drawTooltip(chart, hit);
  },
};

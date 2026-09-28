// The Tax Bracket chart as a presentation ChartSpec: the income tax base as a
// bar — other income, then the taxable Roth conversion on top — over one line
// per federal bracket floor. Shared by the Tax Bracket (Federal) sheet and the
// Tax Summary sheet, so both print what the solver and income-tax page draw.

import type { ProjectionYear } from "@/engine/types";
import {
  bracketFloorSeries,
  bracketRateLabel,
  buildBracketFillModel,
} from "@/lib/tax/bracket-fill";
import { bracketFloorColor, dataPalette } from "@/lib/chart-palette";
import type { TableMarker } from "../types";
import type { ChartSpec } from "./types";
import { buildDrillChartSpec, type BuildDrillChartSpecInput } from "../shared/build-chart-spec";

export function buildBracketChartSpec(
  years: ProjectionYear[],
  markers: TableMarker[],
  frame?: BuildDrillChartSpecInput["frame"],
): ChartSpec {
  // The axis ceiling is the screen chart's (just above the tallest filled
  // tier's top, so the room left in the bracket shows). A floor is drawn only
  // while it is under that ceiling: the canvas clips a line that climbs off
  // the top, but a PDF polyline has no clip, and one 37% floor left running
  // to $2M by the plan's last year dragged the axis to $2.5M and pressed the
  // bars into the bottom sixth of the sheet.
  const fill = buildBracketFillModel(years);
  const palette = dataPalette("light");
  return buildDrillChartSpec({
    years: fill.years.map((y) => y.year),
    yMax: fill.yMax,
    frame,
    stacks: [
      {
        seriesId: "incomeBase", label: "Income tax base",
        color: palette.blue,
        values: fill.years.map((y) => y.otherIncome),
      },
      {
        // "Roth conversion", not "Taxable Roth conversion": the longer name
        // overran its 7pt legend slot into the next swatch.
        seriesId: "conversion", label: "Roth conversion",
        color: palette.orange,
        values: fill.years.map((y) => y.conversion),
      },
    ],
    lines: bracketFloorSeries(fill).map((f) => ({
      seriesId: `floor-${f.rate}`,
      label: `${bracketRateLabel(f.rate)} floor`,
      color: bracketFloorColor(f.rank, "light"),
      strokeWidth: 1,
      values: f.values.map((v) => (v < fill.yMax ? v : NaN)),
    })),
    markers,
  });
}

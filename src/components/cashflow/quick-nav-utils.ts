export type QuickNavView = "base" | "withdrawals" | "assets";

export function activeViewFromDrillPath(drillPath: string[]): QuickNavView {
  const top = drillPath[0];
  if (top === "cashflow") return "withdrawals";
  if (top === "portfolio") return "assets";
  return "base";
}

export function drillPathForView(view: QuickNavView): string[] {
  switch (view) {
    case "withdrawals":
      return ["cashflow"];
    case "assets":
      return ["portfolio"];
    case "base":
      return [];
  }
}

export function viewFromSearchParam(param: string | null): QuickNavView {
  if (param === "withdrawals") return "withdrawals";
  if (param === "assets") return "assets";
  return "base";
}

export function searchParamForView(view: QuickNavView): string | null {
  return view === "base" ? null : view;
}

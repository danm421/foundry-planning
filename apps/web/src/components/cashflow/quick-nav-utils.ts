export type QuickNavView =
  | "base"
  | "income"
  | "expenses"
  | "withdrawals"
  | "assets";

export function activeViewFromDrillPath(drillPath: string[]): QuickNavView {
  const top = drillPath[0];
  if (top === "income") return "income";
  if (top === "expenses") return "expenses";
  if (top === "cashflow") return "withdrawals";
  if (top === "portfolio") return "assets";
  return "base";
}

export function drillPathForView(view: QuickNavView): string[] {
  switch (view) {
    case "income":
      return ["income"];
    case "expenses":
      return ["expenses"];
    case "withdrawals":
      return ["cashflow"];
    case "assets":
      return ["portfolio"];
    case "base":
      return [];
  }
}

export function viewFromSearchParam(param: string | null): QuickNavView {
  if (param === "income") return "income";
  if (param === "expenses") return "expenses";
  if (param === "withdrawals") return "withdrawals";
  if (param === "assets") return "assets";
  return "base";
}

export function searchParamForView(view: QuickNavView): string | null {
  return view === "base" ? null : view;
}

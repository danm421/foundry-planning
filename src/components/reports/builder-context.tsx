"use client";
import { createContext, useContext, type ReactNode } from "react";
export type Household = { primaryClientId: string; retirementYear: number; currentYear: number };
type Ctx = { household: Household; widgetData: Record<string, unknown> };
const C = createContext<Ctx | null>(null);
export function ReportBuilderContext({ value, children }: { value: Ctx; children: ReactNode }) {
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useReportContext(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useReportContext outside provider");
  return v;
}

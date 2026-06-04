"use client";
import { createContext, useContext, type ReactNode } from "react";
import {
  type InvestmentOptionCatalog,
  EMPTY_INVESTMENT_OPTION_CATALOG,
} from "@/lib/presentations/investment-option-catalog";
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

interface PresentationOptionsValue {
  investmentCatalog: InvestmentOptionCatalog;
  scenarios: ScenarioOption[];
}

const Ctx = createContext<PresentationOptionsValue | null>(null);

export function PresentationOptionsProvider({
  value,
  children,
}: {
  value: PresentationOptionsValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInvestmentOptionCatalog(): InvestmentOptionCatalog {
  return useContext(Ctx)?.investmentCatalog ?? EMPTY_INVESTMENT_OPTION_CATALOG;
}

export function useScenarioOptions(): ScenarioOption[] {
  return useContext(Ctx)?.scenarios ?? [];
}

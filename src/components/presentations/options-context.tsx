"use client";
import { createContext, useContext, type ReactNode } from "react";
import {
  type InvestmentOptionCatalog,
  EMPTY_INVESTMENT_OPTION_CATALOG,
} from "@/lib/presentations/investment-option-catalog";

const Ctx = createContext<InvestmentOptionCatalog | null>(null);

export function PresentationOptionsProvider({ value, children }: { value: InvestmentOptionCatalog; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInvestmentOptionCatalog(): InvestmentOptionCatalog {
  return useContext(Ctx) ?? EMPTY_INVESTMENT_OPTION_CATALOG;
}

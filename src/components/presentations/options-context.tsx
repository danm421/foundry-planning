"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { InvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";

const Ctx = createContext<InvestmentOptionCatalog | null>(null);

export function PresentationOptionsProvider({ value, children }: { value: InvestmentOptionCatalog; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInvestmentOptionCatalog(): InvestmentOptionCatalog {
  return useContext(Ctx) ?? { groups: [{ key: "all-liquid", name: "All Liquid Assets" }], entities: [] };
}

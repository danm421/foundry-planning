import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_ACCENT, type SectionAccent } from "@/lib/presentations/theme";

const AccentContext = createContext<SectionAccent>(DEFAULT_ACCENT);

export function AccentProvider({
  accent,
  children,
}: {
  accent: SectionAccent;
  children: ReactNode;
}) {
  return <AccentContext.Provider value={accent}>{children}</AccentContext.Provider>;
}

export function useAccent(): SectionAccent {
  return useContext(AccentContext);
}

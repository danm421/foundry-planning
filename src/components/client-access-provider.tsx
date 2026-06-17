"use client";

import { createContext, useContext } from "react";

export type ClientAccess = { permission: "view" | "edit"; access: "own" | "shared" };

const Ctx = createContext<ClientAccess>({ permission: "edit", access: "own" });

export function ClientAccessProvider({
  value,
  children,
}: {
  value: ClientAccess;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientAccess(): ClientAccess {
  return useContext(Ctx);
}

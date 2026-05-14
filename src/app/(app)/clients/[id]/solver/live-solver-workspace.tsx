"use client";

import type { ClientData, ProjectionYear } from "@/engine";

interface Props {
  clientId: string;
  baseClientData: ClientData;
  baseProjection: ProjectionYear[];
  initialSource: "base" | string;
  initialSourceClientData: ClientData;
  initialSourceProjection: ProjectionYear[];
  availableScenarios: { id: string; name: string }[];
}

export function LiveSolverWorkspace(_props: Props) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Live Solver — placeholder</h1>
      <p className="text-sm text-gray-500">
        Workspace UI lands in Task 10. Page wiring is complete.
      </p>
    </div>
  );
}

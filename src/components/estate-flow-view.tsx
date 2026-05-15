"use client";

import type { ClientData } from "@/engine/types";

export interface EstateFlowViewProps {
  clientId: string;
  scenarioId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  initialClientData: ClientData;
}

export default function EstateFlowView(props: EstateFlowViewProps) {
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">Estate Flow</h1>
      <p className="text-sm text-muted-foreground">
        {props.initialClientData.accounts.length} accounts loaded.
      </p>
    </div>
  );
}

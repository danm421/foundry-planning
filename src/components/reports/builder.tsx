// src/components/reports/builder.tsx
//
// Client root of the report builder. Holds the reducer state, the
// currently-selected widget id, and renders the 3-pane layout.

"use client";
import { useReducer, useState } from "react";
import { reducer, type ReportState } from "@/lib/reports/reducer";
import { ReportBuilderContext, type Household } from "./builder-context";
import { TopBar } from "./top-bar";
import { BlockLibrary } from "./block-library";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { useAutosave } from "./use-autosave";
import type { Page } from "@/lib/reports/types";

export function Builder(props: {
  reportId: string;
  clientId: string;
  household: Household;
  householdName: string;
  initial: { title: string; pages: Page[] };
}) {
  const { reportId, clientId, household, householdName, initial } = props;
  const [state, dispatch] = useReducer(reducer, initial as ReportState);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const status = useAutosave({
    clientId,
    reportId,
    state,
    initial: initial as ReportState,
  });

  return (
    <ReportBuilderContext value={{ household }}>
      <div className="flex flex-col h-screen bg-paper">
        <TopBar
          clientId={clientId}
          householdName={householdName}
          title={state.title}
          onTitleChange={(t) => dispatch({ type: "SET_TITLE", title: t })}
          status={status}
          onExport={() => {
            /* wired in Task 13 */
          }}
        />
        <div className="flex flex-1 overflow-hidden">
          <BlockLibrary />
          <Canvas
            pages={state.pages}
            dispatch={dispatch}
            selectedWidgetId={selectedWidgetId}
            onSelectWidget={setSelectedWidgetId}
          />
          <Inspector
            pages={state.pages}
            selectedWidgetId={selectedWidgetId}
            dispatch={dispatch}
          />
        </div>
      </div>
    </ReportBuilderContext>
  );
}

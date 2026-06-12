import { useReducer } from "react";
import type { PresentationPageId } from "@/components/presentations/registry";

export interface LauncherSelectedPage {
  pageId: PresentationPageId;
  options: unknown;
  scenarioOverride: string | null | undefined;
}

export interface LoadedTemplate {
  id: string;
  name: string;
  visibility: "shared" | "private";
  createdByUserId: string;
  /** True for code-defined built-in starters (not a real DB row). */
  builtIn?: boolean;
  /** Stable slug, present only on built-ins; used to dismiss/restore. */
  slug?: string;
  pages: Array<{ pageId: PresentationPageId; options: unknown }>;
}

export interface LauncherState {
  topScenarioPickerValue: string;
  filename: string;
  pages: LauncherSelectedPage[];
  loadedTemplate: LoadedTemplate | null;
  isModified: boolean;
}

export type LauncherAction =
  | { type: "setTopScenario"; value: string }
  | { type: "setFilename"; value: string }
  | { type: "addPage"; pageId: PresentationPageId; options: unknown }
  | { type: "removePage"; index: number }
  | { type: "reorder"; from: number; to: number }
  | { type: "updatePageOptions"; index: number; options: unknown }
  | {
      type: "setScenarioOverride";
      index: number;
      value: string | null | undefined;
    }
  | { type: "loadTemplate"; template: LoadedTemplate }
  | { type: "savedAs"; template: LoadedTemplate }
  | { type: "clear" };

export function initialLauncherState(): LauncherState {
  return {
    topScenarioPickerValue: "base",
    filename: "",
    pages: [],
    loadedTemplate: null,
    isModified: false,
  };
}

function descriptorsEqual(
  a: Array<{ pageId: string; options: unknown }>,
  b: Array<{ pageId: string; options: unknown }>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pageId !== b[i].pageId) return false;
    if (JSON.stringify(a[i].options) !== JSON.stringify(b[i].options)) return false;
  }
  return true;
}

function recomputeIsModified(state: LauncherState): LauncherState {
  const tpl = state.loadedTemplate;
  if (!tpl) return { ...state, isModified: false };
  const stripped = state.pages.map((p) => ({ pageId: p.pageId, options: p.options }));
  return { ...state, isModified: !descriptorsEqual(stripped, tpl.pages) };
}

export function launcherReducer(
  state: LauncherState,
  action: LauncherAction,
): LauncherState {
  switch (action.type) {
    case "setTopScenario":
      return { ...state, topScenarioPickerValue: action.value };
    case "setFilename":
      return { ...state, filename: action.value };
    case "addPage":
      return recomputeIsModified({
        ...state,
        pages: [
          ...state.pages,
          {
            pageId: action.pageId,
            options: action.options,
            scenarioOverride: undefined,
          },
        ],
      });
    case "removePage":
      return recomputeIsModified({
        ...state,
        pages: state.pages.filter((_, i) => i !== action.index),
      });
    case "reorder": {
      const next = state.pages.slice();
      const [moved] = next.splice(action.from, 1);
      next.splice(action.to, 0, moved);
      return recomputeIsModified({ ...state, pages: next });
    }
    case "updatePageOptions": {
      const next = state.pages.map((p, i) =>
        i === action.index ? { ...p, options: action.options } : p,
      );
      return recomputeIsModified({ ...state, pages: next });
    }
    case "setScenarioOverride": {
      const next = state.pages.map((p, i) =>
        i === action.index ? { ...p, scenarioOverride: action.value } : p,
      );
      // scenarioOverride is not persisted to templates, so it does NOT bump isModified.
      return { ...state, pages: next };
    }
    case "loadTemplate": {
      const pages: LauncherSelectedPage[] = action.template.pages.map((p) => ({
        pageId: p.pageId,
        options: p.options,
        scenarioOverride: undefined,
      }));
      return {
        ...state,
        pages,
        loadedTemplate: action.template,
        isModified: false,
      };
    }
    case "savedAs": {
      return { ...state, loadedTemplate: action.template, isModified: false };
    }
    case "clear":
      return initialLauncherState();
  }
}

export function useLauncherState(initial?: LauncherState) {
  return useReducer(launcherReducer, initial ?? initialLauncherState());
}

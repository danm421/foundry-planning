// @vitest-environment jsdom
import { StrictMode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLauncherState, type LauncherState } from "../use-launcher-state";
import { useLauncherDraft, draftKey } from "../use-launcher-draft";

/** Drives the real reducer + the draft hook together, the way the launcher does. */
function useHarness(clientId = "client-1", userId = "user-1") {
  const [state, dispatch] = useLauncherState();
  useLauncherDraft(clientId, userId, state, dispatch);
  return { state, dispatch };
}

/** A non-empty seeded deck, the way the real launcher seeds Foundation Plan. */
function seededDeck(): LauncherState {
  return {
    topScenarioPickerValue: "base",
    filename: "",
    pages: [
      { pageId: "cover", options: {}, scenarioOverride: undefined },
      { pageId: "toc", options: {}, scenarioOverride: undefined },
      { pageId: "cashFlow", options: {}, scenarioOverride: undefined },
    ],
    loadedTemplate: null,
    isModified: false,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useLauncherDraft", () => {
  it("persists deck changes to localStorage under a client+user-scoped key", () => {
    const { result } = renderHook(() => useHarness());
    act(() =>
      result.current.dispatch({
        type: "addPage",
        pageId: "cashFlow",
        options: { range: "full", showCallout: true },
      }),
    );
    const raw = localStorage.getItem(draftKey("client-1", "user-1"));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.v).toBe(1);
    expect(parsed.state.pages).toHaveLength(1);
    expect(parsed.state.pages[0].pageId).toBe("cashFlow");
  });

  it("restores a saved draft on mount — pages, filename, and scenario", () => {
    localStorage.setItem(
      draftKey("client-1", "user-1"),
      JSON.stringify({
        v: 1,
        state: {
          topScenarioPickerValue: "snap:abc",
          filename: "Saved.pdf",
          pages: [{ pageId: "toc", options: {}, scenarioOverride: "scenario-X" }],
          loadedTemplate: null,
          isModified: true,
        },
      }),
    );
    const { result } = renderHook(() => useHarness());
    expect(result.current.state.filename).toBe("Saved.pdf");
    expect(result.current.state.topScenarioPickerValue).toBe("snap:abc");
    expect(result.current.state.pages.map((p) => p.pageId)).toEqual(["toc"]);
    expect(result.current.state.pages[0].scenarioOverride).toBe("scenario-X");
    expect(result.current.state.isModified).toBe(true);
  });

  it("ignores a draft written under a different schema version", () => {
    localStorage.setItem(
      draftKey("client-1", "user-1"),
      JSON.stringify({
        v: 999,
        state: {
          topScenarioPickerValue: "base",
          filename: "Stale.pdf",
          pages: [],
          loadedTemplate: null,
          isModified: false,
        },
      }),
    );
    const { result } = renderHook(() => useHarness());
    expect(result.current.state.filename).not.toBe("Stale.pdf");
  });

  it("drops restored pages whose page type is no longer in the registry", () => {
    localStorage.setItem(
      draftKey("client-1", "user-1"),
      JSON.stringify({
        v: 1,
        state: {
          topScenarioPickerValue: "base",
          filename: "",
          pages: [
            { pageId: "cashFlow", options: {}, scenarioOverride: undefined },
            { pageId: "pageThatNoLongerExists", options: {}, scenarioOverride: undefined },
          ],
          loadedTemplate: null,
          isModified: false,
        },
      }),
    );
    const { result } = renderHook(() => useHarness());
    expect(result.current.state.pages.map((p) => p.pageId)).toEqual(["cashFlow"]);
  });

  it("does not restore a draft saved under a different client", () => {
    localStorage.setItem(
      draftKey("other-client", "user-1"),
      JSON.stringify({
        v: 1,
        state: {
          topScenarioPickerValue: "base",
          filename: "OtherClient.pdf",
          pages: [],
          loadedTemplate: null,
          isModified: false,
        },
      }),
    );
    const { result } = renderHook(() => useHarness("client-1", "user-1"));
    expect(result.current.state.filename).not.toBe("OtherClient.pdf");
  });

  it("survives corrupt JSON in storage without throwing", () => {
    localStorage.setItem(draftKey("client-1", "user-1"), "{not valid json");
    expect(() => renderHook(() => useHarness())).not.toThrow();
  });

  // Regression: under React Strict Mode (which Next dev enables) effects are
  // double-invoked. A seeded (non-empty) initial deck must NOT be persisted
  // over the saved draft before restore lands — otherwise the effect replay
  // re-reads the clobbered default and the deck resets, so added/removed pages
  // appear to "not persist" across navigation.
  it("restores a saved draft under StrictMode even when seeded with a default deck", () => {
    localStorage.setItem(
      draftKey("client-1", "user-1"),
      JSON.stringify({
        v: 1,
        state: {
          topScenarioPickerValue: "base",
          filename: "",
          pages: [
            { pageId: "cover", options: {}, scenarioOverride: undefined },
            { pageId: "toc", options: {}, scenarioOverride: undefined },
            { pageId: "cashFlow", options: {}, scenarioOverride: undefined },
            { pageId: "cashFlow", options: {}, scenarioOverride: undefined },
          ],
          loadedTemplate: null,
          isModified: false,
        },
      }),
    );
    const { result } = renderHook(
      () => {
        const [state, dispatch] = useLauncherState(seededDeck());
        useLauncherDraft("client-1", "user-1", state, dispatch);
        return { state };
      },
      { wrapper: StrictMode },
    );
    // The 4-page saved draft wins over the 3-page seeded default.
    expect(result.current.state.pages).toHaveLength(4);
    const stored = JSON.parse(
      localStorage.getItem(draftKey("client-1", "user-1"))!,
    );
    expect(stored.state.pages).toHaveLength(4);
  });
});

// @vitest-environment jsdom
/**
 * The Solver's editor host runs every editor in hold mode: it loads the view
 * with the host's source and switched-on list, hands saves to `host.hold`, and
 * never touches the network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SolverMutation } from "@/lib/solver/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/solver",
}));

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("../change-editor-actions", () => ({ loadChangeEditorProps: loadMock }));

// A stand-in for the Details view: one button that saves through the writer.
vi.mock("@/components/income-expenses-view", async () => {
  const { useScenarioWriter } = await import("@/hooks/use-scenario-writer");
  return {
    default: function StubView() {
      const { submit, scenarioActive } = useScenarioWriter("c1");
      return (
        <button
          type="button"
          onClick={() =>
            void submit(
              { targetKind: "expense", op: "edit", targetId: "e1", desiredFields: { annualAmount: 12100 } },
              { url: "/api/clients/c1/expenses/e1", method: "PUT", body: {} },
            )
          }
        >
          {scenarioActive ? "Save held" : "Save direct"}
        </button>
      );
    },
  };
});

import { SolverChangeEditor, type HeldEditorHost } from "../solver-change-editor";
import { ClientAccessProvider } from "@/components/client-access-provider";

const MUTATIONS = [{ kind: "retirement-age", person: "client", age: 66 }] as unknown as SolverMutation[];

function host(over: Partial<HeldEditorHost> = {}): HeldEditorHost {
  return {
    source: "scn-1",
    mutations: MUTATIONS,
    hold: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    switchedOffIds: new Set<string>(),
    ...over,
  };
}

function editor(h: HeldEditorHost, id = "e1") {
  return (
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <SolverChangeEditor
        clientId="c1"
        host={h}
        label="Groceries"
        onDone={vi.fn()}
        target={{ surface: "details", page: "income-expenses", focus: { intent: "edit", kind: "expense", id } }}
      />
    </ClientAccessProvider>
  );
}

function renderHost(h: HeldEditorHost, id = "e1") {
  return render(editor(h, id));
}

beforeEach(() => {
  loadMock.mockReset();
  loadMock.mockResolvedValue({ page: "income-expenses", props: {} });
});

describe("SolverChangeEditor — hold mode", () => {
  it("loads the view with the host's source and mutations", async () => {
    renderHost(host());
    await screen.findByRole("button", { name: "Save held" });
    expect(loadMock).toHaveBeenCalledWith("c1", "scn-1", "income-expenses", MUTATIONS);
  });

  it("a rebuilt host list loads nothing again and keeps the view mounted", async () => {
    const { rerender } = renderHost(host());
    await screen.findByRole("button", { name: "Save held" });
    rerender(editor(host({ mutations: [...MUTATIONS], hold: vi.fn() })));
    await Promise.resolve();
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save held" })).toBeInTheDocument();
  });

  it("a dialog save calls host.hold and never fetches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const h = host();
    renderHost(h);
    fireEvent.click(await screen.findByRole("button", { name: "Save held" }));
    await waitFor(() => expect(h.hold).toHaveBeenCalledTimes(1));
    expect(h.hold).toHaveBeenCalledWith([
      { targetKind: "expense", op: "edit", targetId: "e1", desiredFields: { annualAmount: 12100 } },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("an item in a switched-off saved group shows the message and loads nothing", async () => {
    renderHost(host({ switchedOffIds: new Set(["e1"]) }));
    expect(
      await screen.findByText("This item has a saved change that's switched off. Switch it on to edit it here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(loadMock).not.toHaveBeenCalled();
  });
});

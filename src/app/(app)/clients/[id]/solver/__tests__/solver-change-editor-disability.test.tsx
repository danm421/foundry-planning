// @vitest-environment jsdom
/**
 * The Solver host mounts the REAL disability panel for a disability focus: a
 * Solver "Add disability policy" (a create focus) opens the create dialog.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClientInfo } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("scenario=scn-1"),
  usePathname: () => "/clients/c1/solver",
}));

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("../change-editor-actions", () => ({ loadChangeEditorProps: loadMock }));

import { SolverChangeEditor } from "../solver-change-editor";
import { ClientAccessProvider } from "@/components/client-access-provider";

const CLIENT: ClientInfo = {
  firstName: "Cooper",
  lastName: "Reed",
  dateOfBirth: "1980-06-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Jane",
  spouseDob: "1982-03-01",
  filingStatus: "married_joint",
};

function disabilityLoad() {
  return {
      page: "insurance",
      props: { clientId: "c1" },
      disabilityProps: {
        clientId: "c1",
        policies: [],
        clientFirstName: "Cooper",
        spouseFirstName: "Jane",
        currentSalaryByPerson: { client: 200_000, spouse: 0 },
        currentYear: 2026,
        planStartYear: 2024,
        inflationRate: 0.03,
        planEndYear: 2060,
        client: CLIENT,
      },
  };
}

describe("SolverChangeEditor — disability focus", () => {
  it("a create focus mounts the disability panel and opens its Add dialog", async () => {
    loadMock.mockResolvedValue(disabilityLoad());
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <SolverChangeEditor
          clientId="c1"
          scenarioId="scn-1"
          label="Disability policy"
          onDone={vi.fn()}
          target={{
            surface: "details",
            page: "insurance",
            focus: { intent: "create", kind: "disability_policy" },
          }}
        />
      </ClientAccessProvider>,
    );
    expect(await screen.findByRole("dialog", { name: "Add disability policy" })).toBeInTheDocument();
  });

  // The view reports "unavailable" when the focused row is not in the plan. For
  // an edit that means "this editor can't open it here — try Details"; for a
  // DELETE the row is simply gone, and pointing at the Details editor reads wrong.
  function renderMissing(intent: "edit" | "delete") {
    loadMock.mockResolvedValue(disabilityLoad());
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <SolverChangeEditor
          clientId="c1"
          scenarioId="scn-1"
          label="Disability policy"
          onDone={vi.fn()}
          target={{
            surface: "details",
            page: "insurance",
            focus: { intent, kind: "disability_policy", id: "dp-gone" },
          }}
        />
      </ClientAccessProvider>,
    );
  }

  it("a delete whose row has vanished says so, with no Details link", async () => {
    renderMissing("delete");
    expect(await screen.findByText("This item is no longer in the plan.")).toBeInTheDocument();
    expect(screen.queryByText("Not editable from the Solver.")).toBeNull();
    expect(screen.queryByRole("link", { name: /details page/i })).toBeNull();
  });

  it("an edit whose row is missing still points at the Details page", async () => {
    renderMissing("edit");
    expect(await screen.findByText("Not editable from the Solver.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /details page/i })).toBeInTheDocument();
  });
});

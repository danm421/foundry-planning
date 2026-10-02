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

describe("SolverChangeEditor — disability focus", () => {
  it("a create focus mounts the disability panel and opens its Add dialog", async () => {
    loadMock.mockResolvedValue({
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
    });
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
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveAsScenarioDialog } from "../save-as-scenario-dialog";

const baseProps = {
  open: true,
  mutations: [
    { kind: "retirement-age", person: "client", age: 67 },
    { kind: "ss-claim-age", person: "client", age: 70 },
  ] as never,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
};

beforeEach(() => {
  baseProps.onClose.mockReset();
  baseProps.onSubmit.mockReset();
});

describe("<SaveAsScenarioDialog />", () => {
  it("renders a human-readable line per mutation", () => {
    render(<SaveAsScenarioDialog {...baseProps} />);
    expect(screen.getByText(/Retirement age/i)).toBeInTheDocument();
    expect(screen.getByText(/SS claim age/i)).toBeInTheDocument();
  });

  it("disables Save when name is empty", () => {
    render(<SaveAsScenarioDialog {...baseProps} />);
    const save = screen.getByRole("button", { name: /save scenario/i });
    expect(save).toBeDisabled();
  });

  it("calls onSubmit with the entered name when Save is clicked", () => {
    render(<SaveAsScenarioDialog {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: "Retire at 67" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save scenario/i }));
    expect(baseProps.onSubmit).toHaveBeenCalledWith({ name: "Retire at 67" });
  });

  // M1 — the will's grantor is the raw `client`/`spouse` enum. Rendering it
  // verbatim puts "spouse" into advisor-facing copy, which the co-client
  // terminology sweep already removed everywhere else.
  it("names the will's grantor the way the rest of the app does", () => {
    render(
      <SaveAsScenarioDialog
        {...baseProps}
        mutations={
          [
            { kind: "will-upsert", id: "w-1", value: { id: "w-1", grantor: "spouse", bequests: [] } },
          ] as never
        }
      />,
    );
    expect(screen.getByText(/Will \(Co-client\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Will \(spouse\)/)).toBeNull();
  });

  // M2 — `entityType` is a seven-member union; the two-way test called a
  // foundation a "Business".
  it("calls a foundation a foundation, not a business", () => {
    render(
      <SaveAsScenarioDialog
        {...baseProps}
        mutations={
          [
            {
              kind: "entity-upsert",
              id: "e-f",
              value: { id: "e-f", name: "Smith Family Foundation", entityType: "foundation" },
            },
            {
              kind: "entity-upsert",
              id: "e-llc",
              value: { id: "e-llc", name: "Smith Holdings LLC", entityType: "llc" },
            },
            {
              kind: "entity-upsert",
              id: "e-t",
              value: { id: "e-t", name: "Smith Family ILIT", entityType: "trust" },
            },
          ] as never
        }
      />,
    );
    expect(screen.getByText(/Foundation: Smith Family Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/Business: Smith Holdings LLC/)).toBeInTheDocument();
    expect(screen.getByText(/Trust: Smith Family ILIT/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RiskStep } from "../risk-step";
import { RTQ_V1 } from "@/lib/risk/rtq";

describe("RiskStep", () => {
  it("renders every RTQ_V1 question", () => {
    render(<RiskStep value={undefined} onChange={vi.fn()} />);
    for (const q of RTQ_V1) {
      expect(screen.getByText(q.prompt)).toBeInTheDocument();
    }
  });

  it("has no Submit button — the wizard chrome owns that affordance", () => {
    render(<RiskStep value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^submit$/i })).not.toBeInTheDocument();
  });

  it("lifts an answer to onChange rather than holding it internally", () => {
    const onChange = vi.fn();
    render(<RiskStep value={undefined} onChange={onChange} />);
    const first = RTQ_V1[0];
    fireEvent.click(screen.getByLabelText(first.options[0].label));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ answers: { [first.id]: first.options[0].value } }),
    );
  });

  it("renders the answers it is given", () => {
    const first = RTQ_V1[0];
    render(
      <RiskStep value={{ answers: { [first.id]: first.options[1].value } }} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(first.options[1].label)).toBeChecked();
  });

  it("keeps earlier answers when a later question is answered", () => {
    // Controlled mode: if the step held its own state, the second answer would
    // arrive alone and the first would be lost on the next render.
    const [q1, q2] = RTQ_V1;
    const onChange = vi.fn();
    render(
      <RiskStep value={{ answers: { [q1.id]: q1.options[0].value } }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText(q2.options[0].label));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { [q1.id]: q1.options[0].value, [q2.id]: q2.options[0].value },
      }),
    );
  });

  it("lifts the environment note", () => {
    const onChange = vi.fn();
    render(<RiskStep value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Just retired." } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ environmentNote: "Just retired." }),
    );
  });

  it("renders the environment note it is given", () => {
    render(
      <RiskStep value={{ answers: {}, environmentNote: "Sold a business." }} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("Sold a business.");
  });
});

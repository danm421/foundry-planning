// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanQuestionsCard } from "../plan-questions-card";
import type { AssembleQuestion } from "@/lib/imports/assemble/types";

const TEXT_QUESTION: AssembleQuestion = {
  id: "q:primary_dob",
  kind: "identity",
  field: "client.primaryDob",
  prompt: "What is the client's date of birth?",
};

const OPTIONS_QUESTION: AssembleQuestion = {
  id: "q:filing_status",
  kind: "assumption",
  field: "client.filingStatus",
  prompt: "What is the filing status?",
  options: ["single", "married_joint"],
};

describe("PlanQuestionsCard", () => {
  it("renders nothing when there are no questions", () => {
    const { container } = render(
      <PlanQuestionsCard questions={[]} busy={false} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one input per question", () => {
    render(
      <PlanQuestionsCard
        questions={[TEXT_QUESTION, OPTIONS_QUESTION]}
        busy={false}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(TEXT_QUESTION.prompt)).toBeInTheDocument();
    expect(screen.getByLabelText(OPTIONS_QUESTION.prompt)).toBeInTheDocument();
  });

  it("renders a text input when options is absent", () => {
    render(
      <PlanQuestionsCard questions={[TEXT_QUESTION]} busy={false} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(screen.getByLabelText(TEXT_QUESTION.prompt).tagName).toBe("INPUT");
  });

  it("renders a select when options is present", () => {
    render(
      <PlanQuestionsCard
        questions={[OPTIONS_QUESTION]}
        busy={false}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    const el = screen.getByLabelText(OPTIONS_QUESTION.prompt);
    expect(el.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "single" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "married_joint" })).toBeInTheDocument();
  });

  it("disables submit until at least one field has a value, then enables it", () => {
    render(
      <PlanQuestionsCard questions={[TEXT_QUESTION]} busy={false} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    const submit = screen.getByRole("button", { name: /submit answers/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(TEXT_QUESTION.prompt), { target: { value: "1975-01-01" } });
    expect(submit).not.toBeDisabled();
  });

  it("disables submit while busy even with a filled field", () => {
    render(
      <PlanQuestionsCard questions={[TEXT_QUESTION]} busy={true} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(TEXT_QUESTION.prompt), { target: { value: "1975-01-01" } });
    expect(screen.getByRole("button", { name: /submit answers/i })).toBeDisabled();
  });

  it("submits only the non-empty answers, keyed by question id", () => {
    const onSubmit = vi.fn();
    render(
      <PlanQuestionsCard
        questions={[TEXT_QUESTION, OPTIONS_QUESTION]}
        busy={false}
        onSubmit={onSubmit}
        onSkip={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(TEXT_QUESTION.prompt), { target: { value: "1975-01-01" } });
    // Leave OPTIONS_QUESTION blank.
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));
    expect(onSubmit).toHaveBeenCalledWith({ "q:primary_dob": "1975-01-01" });
  });

  it("calls onSkip when Skip is clicked", () => {
    const onSkip = vi.fn();
    render(
      <PlanQuestionsCard questions={[TEXT_QUESTION]} busy={false} onSubmit={vi.fn()} onSkip={onSkip} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("has the data-testid used to locate the card", () => {
    render(
      <PlanQuestionsCard questions={[TEXT_QUESTION]} busy={false} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(screen.getByTestId("forge-plan-questions")).toBeInTheDocument();
  });
});

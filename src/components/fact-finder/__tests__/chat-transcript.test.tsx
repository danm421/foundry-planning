// @vitest-environment jsdom
// src/components/fact-finder/__tests__/chat-transcript.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { FFChatTurn } from "@/lib/fact-finder/types";
import { ChatTranscript } from "../chat-transcript";

const AT = "2026-10-13T09:00:00.000Z";

function renderTranscript(transcript: FFChatTurn[], extra: { pending?: string | null; progress?: string[] } = {}) {
  return render(
    <ChatTranscript
      transcript={transcript}
      undoable={{}}
      pending={extra.pending ?? null}
      undoing={null}
      progress={extra.progress ?? []}
      onUndo={() => {}}
      renderProposal={(turn) => <div data-testid="slot">card for {turn.rowIds.join(",")}</div>}
    />,
  );
}

describe("ChatTranscript", () => {
  it("renders assistant markdown tables", () => {
    renderTranscript([
      { id: "a1", role: "assistant", text: "| Account | Value |\n| --- | --- |\n| Joint Checking | 13,000 |", at: AT },
    ]);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Joint Checking" })).toBeInTheDocument();
  });

  it("renders the proposal slot", () => {
    renderTranscript([{ id: "p1", role: "proposal", rowIds: ["r1", "r2"], at: AT }]);
    expect(screen.getByTestId("slot")).toHaveTextContent("card for r1,r2");
  });

  it("shows live progress lines under the pending message", () => {
    renderTranscript([], { pending: "Add a table", progress: ["Looking at the accounts…", "Adding the table…"] });
    expect(screen.getByText("Add a table")).toBeInTheDocument();
    const lines = screen.getByRole("status");
    expect(lines).toHaveTextContent("Looking at the accounts…");
    expect(lines).toHaveTextContent("Adding the table…");
  });

  it("shows no bubble for a compose run, only its progress", () => {
    renderTranscript([], { pending: "", progress: ["Folding in the new documents…"] });
    expect(screen.getByRole("status")).toHaveTextContent("Folding in the new documents…");
    expect(screen.queryByText("Ask a question about this fact finder, or say what to change.")).toBeNull();
  });
});

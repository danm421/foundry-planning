// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { CollapsibleListEditor } from "../collapsible-list-editor";

type Row = { _id: number; serverId?: string; label: string; pinned?: boolean };

/** Controlled harness — mirrors how a step wires the primitive to lifted state. */
function Harness({ initial = [] as Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  let next = 100;
  return (
    <CollapsibleListEditor<Row>
      rows={rows}
      columns={[{ key: "label", label: "Label" }]}
      isPinned={(r) => !!r.pinned}
      isEmpty={(r) => r.label === ""}
      newRow={() => ({ _id: next++, label: "" })}
      onChange={setRows}
      onRemove={(r) => setRows((rs) => rs.filter((x) => x._id !== r._id))}
      update={(id, patch) =>
        setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)))
      }
      rowLabel={(r) => `row ${r.label || r._id}`}
      renderSummary={(r) => [<span key="l">{r.label || "—"}</span>]}
      renderEditor={(r, upd) => (
        <input
          aria-label={`edit-${r._id}`}
          value={r.label}
          onChange={(e) => upd({ label: e.target.value })}
        />
      )}
      addLabel="+ Add row"
    />
  );
}

describe("CollapsibleListEditor", () => {
  it("opens one row at a time (accordion)", async () => {
    const u = userEvent.setup();
    render(<Harness initial={[{ _id: 1, label: "A" }, { _id: 2, label: "B" }]} />);
    await u.click(screen.getByRole("button", { name: /row A/i }));
    expect(screen.getByLabelText("edit-1")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /row B/i }));
    expect(screen.getByLabelText("edit-2")).toBeInTheDocument();
    expect(screen.queryByLabelText("edit-1")).not.toBeInTheDocument();
  });

  it("Add appends a new row already expanded", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole("button", { name: "+ Add row" }));
    expect(screen.getByLabelText("edit-100")).toBeInTheDocument();
  });

  it("pinned rows show no Remove; normal rows do and remove", async () => {
    const u = userEvent.setup();
    render(
      <Harness initial={[{ _id: 1, label: "P", pinned: true }, { _id: 2, label: "N" }]} />,
    );
    await u.click(screen.getByRole("button", { name: /row P/i }));
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /row N/i }));
    await u.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.queryByLabelText("edit-2")).not.toBeInTheDocument();
  });
});

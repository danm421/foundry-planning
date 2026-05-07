// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OwnershipEditor } from "../ownership-editor";

const familyMembers = [
  { id: "fm-c", role: "client" as const, firstName: "Alice" },
  { id: "fm-s", role: "spouse" as const, firstName: "Bob" },
  { id: "fm-k", role: "child" as const, firstName: "Cara" },
];
const entities = [{ id: "ent-trust", name: "Family Trust" }];

describe("OwnershipEditor", () => {
  it("Client preset writes one row at 100%", () => {
    const onChange = vi.fn();
    render(<OwnershipEditor familyMembers={familyMembers} entities={entities}
      value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onChange).toHaveBeenCalledWith([
      { kind: "family_member", familyMemberId: "fm-c", percent: 1 },
    ]);
  });

  it("Joint 50/50 preset writes two rows", () => {
    const onChange = vi.fn();
    render(<OwnershipEditor familyMembers={familyMembers} entities={entities}
      value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Joint 50/50"));
    expect(onChange).toHaveBeenCalledWith([
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-s", percent: 0.5 },
    ]);
  });

  it("Joint 50/50 preset hidden when no spouse FM", () => {
    const onChange = vi.fn();
    render(<OwnershipEditor familyMembers={[familyMembers[0], familyMembers[2]]} entities={entities}
      value={[]} onChange={onChange} />);
    expect(screen.queryByText("Joint 50/50")).not.toBeInTheDocument();
    expect(screen.queryByText("Spouse")).not.toBeInTheDocument();
  });

  it("Retirement mode shows single-owner caption + hides multi-owner presets", () => {
    render(<OwnershipEditor familyMembers={familyMembers} entities={entities}
      value={[{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]}
      onChange={vi.fn()} retirementMode={true} />);
    expect(screen.queryByText("Joint 50/50")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
    expect(screen.getByText(/IRS rules require a single owner/i)).toBeInTheDocument();
  });

  it("Custom shows total + flips to destructive color when sum != 100%", () => {
    const { rerender } = render(<OwnershipEditor familyMembers={familyMembers} entities={entities}
      value={[
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.4 },
        { kind: "family_member", familyMemberId: "fm-s", percent: 0.4 },
      ]}
      onChange={vi.fn()} />);
    // 80% — should show "must equal 100%" hint
    expect(screen.getByText(/must equal 100%/i)).toBeInTheDocument();

    rerender(<OwnershipEditor familyMembers={familyMembers} entities={entities}
      value={[
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-s", percent: 0.5 },
      ]}
      onChange={vi.fn()} />);
    expect(screen.queryByText(/must equal 100%/i)).not.toBeInTheDocument();
  });

  it("Custom mode: clicking + Add owner calls onChange with a new empty-ish row appended", () => {
    const onChange = vi.fn();
    // Start with one custom row (non-preset shape triggers Custom mode)
    render(<OwnershipEditor familyMembers={familyMembers} entities={entities}
      value={[
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.4 },
        { kind: "family_member", familyMemberId: "fm-s", percent: 0.4 },
      ]}
      onChange={onChange} />);

    fireEvent.click(screen.getByText(/\+ Add owner/i));

    // onChange should have been called with 3 rows; the third is a new empty fm row
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(3);
    // Existing rows preserved
    expect(next[0]).toMatchObject({ kind: "family_member", familyMemberId: "fm-c" });
    expect(next[1]).toMatchObject({ kind: "family_member", familyMemberId: "fm-s" });
    // Third row is a new blank family_member row
    expect(next[2]).toMatchObject({ kind: "family_member", percent: 0 });
  });

  // ── New tests for fix #2, #5 ───────────────────────────────────────────────

  it("Preset → Custom transition: clicking Custom when a preset is active exposes custom row editor", () => {
    render(
      <OwnershipEditor
        familyMembers={familyMembers}
        entities={entities}
        value={[{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]}
        onChange={vi.fn()}
      />,
    );
    // Sanity: "+ Add owner" is not visible while in Client preset mode
    expect(screen.queryByText(/\+ Add owner/i)).not.toBeInTheDocument();
    // Click Custom
    fireEvent.click(screen.getByText("Custom"));
    // The custom row editor (including "+ Add owner") should now be visible
    expect(screen.getByText(/\+ Add owner/i)).toBeInTheDocument();
  });

  it("aria-pressed reflects active preset: Client active, others inactive", () => {
    render(
      <OwnershipEditor
        familyMembers={familyMembers}
        entities={entities}
        value={[{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice").closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Bob").closest("button")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Joint 50/50").closest("button")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Custom").closest("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("Floating-point round-trip: near-50/50 split derives as joint mode", () => {
    render(
      <OwnershipEditor
        familyMembers={familyMembers}
        entities={entities}
        value={[
          { kind: "family_member", familyMemberId: "fm-c", percent: 0.5000001 },
          { kind: "family_member", familyMemberId: "fm-s", percent: 0.4999999 },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Joint 50/50").closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Alice").closest("button")).toHaveAttribute("aria-pressed", "false");
  });
});

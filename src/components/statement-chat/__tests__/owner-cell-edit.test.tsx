// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OwnerCellEdit from "../owner-cell-edit";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";

/**
 * The Owner cell used to offer three words — Client, Co-client, Joint — which
 * is a vocabulary no statement prints and which cannot name a child, a trust,
 * or anybody else on the plan. It now offers the plan's own people and entities
 * and writes `owners[]`, the shape `commit/accounts.ts` persists verbatim.
 *
 * What these pin is that every option the control OFFERS is one the commit can
 * actually WRITE: a pick that gets silently discarded downstream reads as a
 * dead dropdown, which is exactly the defect this replaced.
 */
const FAMILY: OwnerMatchFamilyMember[] = [
  { id: "fm-1", role: "client", firstName: "Michael", lastName: "Sharesky" },
  { id: "fm-2", role: "spouse", firstName: "Julia", lastName: "Sharesky" },
  { id: "fm-3", role: "child", firstName: "Ellie", lastName: "Sharesky" },
];

const ENTITIES = [{ id: "ent-1", name: "Sharesky Family Trust" }];

const renderCell = (props: Partial<React.ComponentProps<typeof OwnerCellEdit>> = {}) =>
  render(
    <OwnerCellEdit family={FAMILY} entities={ENTITIES} onDone={vi.fn()} {...props} />,
  );

describe("owner cell edit", () => {
  it("offers every person and entity on the plan, by real name", () => {
    renderCell();
    const select = screen.getByLabelText("Owner");
    expect(
      [...select.querySelectorAll("option")].filter((o) => !o.disabled).map((o) => o.textContent),
    ).toEqual([
      "Michael Sharesky (client)",
      "Julia Sharesky (co-client)",
      "Ellie Sharesky",
      "Michael & Julia (joint)",
      "Sharesky Family Trust",
    ]);
  });

  it("keeps a placeholder that cannot be chosen", () => {
    renderCell();
    expect(screen.getByRole("option", { name: "Select..." })).toBeDisabled();
  });

  it("writes one family member at 100%", async () => {
    const onDone = vi.fn();
    renderCell({ onDone });
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "fm:fm-3");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith([
      { kind: "family_member", familyMemberId: "fm-3", percent: 1 },
    ]);
  });

  it("writes the two spouses at 50/50 for a joint pick", async () => {
    const onDone = vi.fn();
    renderCell({ onDone });
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "joint");
    expect(onDone).toHaveBeenCalledWith([
      { kind: "family_member", familyMemberId: "fm-1", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-2", percent: 0.5 },
    ]);
  });

  it("writes a trust as a single entity owner", async () => {
    const onDone = vi.fn();
    renderCell({ onDone });
    await userEvent.selectOptions(screen.getByLabelText("Owner"), "ent:ent-1");
    expect(onDone).toHaveBeenCalledWith([
      { kind: "entity", entityId: "ent-1", percent: 1 },
    ]);
  });

  it("pre-selects the owner the row already carries", () => {
    renderCell({ owners: [{ kind: "entity", entityId: "ent-1", percent: 1 }] });
    expect((screen.getByLabelText("Owner") as HTMLSelectElement).value).toBe("ent:ent-1");
  });

  /**
   * The `account_owners_retirement_check` trigger holds an IRA to exactly one
   * owner at 100%, and `writeImportedOwners` collapses a multi-owner retirement
   * set back to coarse synthesis rather than failing — so a joint pick on an IRA
   * would be silently discarded.
   */
  it("offers no joint option on a retirement account", () => {
    renderCell({ subType: "traditional_ira" });
    expect(screen.queryByRole("option", { name: /joint/i })).toBeNull();
    expect(screen.getByRole("option", { name: "Michael Sharesky (client)" })).toBeInTheDocument();
  });

  /** A 529 gets no `account_owners` rows at all — it is attributed to its
   *  beneficiary, so a picker here would write a value nothing reads. */
  it("offers no picker at all on a 529", () => {
    renderCell({ is529: true });
    expect(screen.queryByLabelText("Owner")).toBeNull();
    expect(screen.getByText(/attributed to its beneficiary/i)).toBeInTheDocument();
  });

  it("never reports an empty value, even if a change event carries one", () => {
    const onDone = vi.fn();
    renderCell({ onDone, owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }] });
    // The placeholder is `disabled`, so a user cannot reach this — but the
    // guard behind it is what keeps a stray change event from writing an
    // empty owner set.
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "" } });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("says so when the plan has nobody to pick yet", () => {
    render(<OwnerCellEdit family={[]} entities={[]} onDone={vi.fn()} />);
    expect(screen.getByRole("option", { name: /nobody on this plan yet/i })).toBeInTheDocument();
  });

  it("shows the registration name and why it is only an assumption", () => {
    renderCell({ hint: "JULIA B. SAMPLE" });
    expect(screen.getByText(/JULIA B. SAMPLE/)).toBeInTheDocument();
    expect(screen.getByText(/not confirmed/i)).toBeInTheDocument();
  });
});

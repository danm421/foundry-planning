// @vitest-environment jsdom
/**
 * The Estate step's three load-bearing behaviours, each of which is a decision
 * the step could plausibly have made the other way:
 *
 *   1. Contact details are asked once per PERSON, not once per nomination.
 *   2. What the Family step already answered is READ, never re-asked — and an
 *      ABSENT family means show everything, not hide it.
 *   3. "Is this your legal residence?" is a tri-state. Unanswered is a real
 *      state and must never render, or record, as a No.
 *
 * Query note: the six nomination fields carry `list=` (the "already named
 * someone?" datalist), which maps them to role COMBOBOX rather than textbox.
 * They are reached through `slotInput` so a future change to that affordance
 * breaks one helper rather than a dozen assertions.
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { EstateStep, type EstateSlice } from "../estate-step";

type Family = IntakeDraft["family"];

const FAMILY_WITH_KIDS: Family = {
  primary: { firstName: "Matt", lastName: "Ruiz", dateOfBirth: "1980-02-11" },
  spouse: { firstName: "Bre", lastName: "Ruiz", dateOfBirth: "1982-05-09" },
  children: [
    { firstName: "Emma", dateOfBirth: "2014-04-02" },
    { firstName: "Jack", dateOfBirth: "2017-08-19" },
  ],
};

/** Explicitly childless AND single — the Family step ran and said so. */
const FAMILY_NO_KIDS: Family = {
  primary: { firstName: "Matt", lastName: "Ruiz", dateOfBirth: "1980-02-11" },
  children: [],
};

const QUESTION = {
  guardian: "Who would raise your children?",
  trustee: "Who should manage money left for them?",
  executor: "Who should settle your estate?",
} as const;

/** The "(optional)" suffix runs straight onto the label with no separating
 *  space — the repo-wide convention in every intake step, matched here rather
 *  than worked around. */
const PHONE = /^phone\(optional\)$/i;
const BACKUP = /^backup\(optional\)$/i;

/** The name field for one slot, e.g. the trustee's backup. */
function slotInput(
  role: keyof typeof QUESTION,
  priority: "primary" | "backup",
): HTMLInputElement {
  const card = screen.getByText(QUESTION[role]).closest("div");
  if (!card) throw new Error(`no card rendered for ${role}`);
  return within(card).getByRole("combobox", {
    name: priority === "primary" ? /^first choice$/i : BACKUP,
  }) as HTMLInputElement;
}

/** A live step, so a name typed into a slot really does produce its contact
 *  card — the name→contact join is the thing under test, not the setter. */
function Harness({
  family = FAMILY_WITH_KIDS,
  initial = {} as EstateSlice,
  collectsFamily = true,
}: {
  family?: Family;
  initial?: EstateSlice;
  collectsFamily?: boolean;
}) {
  const [value, setValue] = useState<EstateSlice>(initial);
  // The family slice is stateful too: the quick-add writes a child into it and
  // ticks them here in one update, and a static prop could not show that.
  const [fam, setFam] = useState<Family>(family);
  return (
    <EstateStep
      value={value}
      onChange={setValue}
      family={fam}
      collectsFamily={collectsFamily}
      onAddFamilyChild={(child, estate) => {
        setFam((f) => ({ ...f, children: [...(f?.children ?? []), child] }));
        setValue(estate);
      }}
    />
  );
}

describe("EstateStep — contact details are asked once per person", () => {
  it("renders one contact card per distinct person named", () => {
    render(<Harness />);

    fireEvent.change(slotInput("guardian", "primary"), {
      target: { value: "Sarah Klein" },
    });
    fireEvent.change(slotInput("trustee", "primary"), {
      target: { value: "Dev Patel" },
    });

    expect(screen.getAllByRole("textbox", { name: PHONE })).toHaveLength(2);
    expect(screen.getByText("Sarah Klein")).toBeInTheDocument();
    expect(screen.getByText("Dev Patel")).toBeInTheDocument();
  });

  it("asks ONE person named for two roles for their phone number once", () => {
    // The decision this test exists to pin: the same brother is routinely both
    // trustee and executor. Six roles must never mean six phone numbers.
    render(<Harness />);

    fireEvent.change(slotInput("trustee", "primary"), {
      target: { value: "Sarah Klein" },
    });
    fireEvent.change(slotInput("executor", "primary"), {
      target: { value: "Sarah Klein" },
    });

    expect(screen.getAllByRole("textbox", { name: PHONE })).toHaveLength(1);
    // ...and the single card says which hats she wears.
    expect(
      screen.getByText("Trustee · First choice · Executor · First choice"),
    ).toBeInTheDocument();
  });

  it("matches two spellings of one name to a single card", () => {
    render(<Harness />);

    fireEvent.change(slotInput("trustee", "primary"), {
      target: { value: "Sarah Klein" },
    });
    fireEvent.change(slotInput("executor", "primary"), {
      target: { value: "  sarah klein " },
    });

    expect(screen.getAllByRole("textbox", { name: PHONE })).toHaveLength(1);
  });

  it("shows no contact section at all until somebody is named", () => {
    render(<Harness />);
    expect(screen.queryByRole("textbox", { name: PHONE })).toBeNull();
  });

  it("files a typed phone number under the person's name", () => {
    const onChange = vi.fn();
    render(
      <EstateStep
        value={{
          fiduciaries: [{ role: "trustee", priority: "primary", name: "Sarah Klein" }],
        }}
        onChange={onChange}
        family={FAMILY_WITH_KIDS}
        collectsFamily
        onAddFamilyChild={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: PHONE }), {
      target: { value: "734-555-0100" },
    });

    const next: EstateSlice = onChange.mock.calls[0][0];
    expect(next?.fiduciaryContacts).toEqual([
      { name: "Sarah Klein", phone: "734-555-0100" },
    ]);
  });
});

describe("EstateStep — what Family already answered is read, not re-asked", () => {
  it("addresses the principals by the names the Family step collected", () => {
    render(<Harness />);
    expect(screen.getByText("Matt")).toBeInTheDocument();
    expect(screen.getByText("Bre")).toBeInTheDocument();
    // ...and does NOT ask for them again.
    expect(screen.queryByRole("textbox", { name: /first name/i })).toBeNull();
  });

  it("names the children under the guardianship question", () => {
    render(<Harness />);
    expect(screen.getByText("For Emma and Jack.")).toBeInTheDocument();
  });

  it("hides guardianship and the children's schedule when Family says no children", () => {
    render(<Harness family={FAMILY_NO_KIDS} />);

    expect(screen.queryByText(QUESTION.guardian)).toBeNull();
    expect(
      screen.queryByRole("radio", { name: /use the schedule we suggest/i }),
    ).toBeNull();
    // The roles that are not about children survive.
    expect(screen.getByText(QUESTION.trustee)).toBeInTheDocument();
    expect(screen.getByText(QUESTION.executor)).toBeInTheDocument();
  });

  it("hides the spouse's contact fields when Family says there is no spouse", () => {
    render(<Harness family={FAMILY_NO_KIDS} />);
    expect(screen.getAllByRole("textbox", { name: /^mobile$/i })).toHaveLength(1);
  });

  it("SHOWS everything when the form does not collect Family at all", () => {
    // An estate-only form carries no family slice. Hiding on that basis would
    // silently collect half a questionnaire — absence means unknown, not "no".
    // Rendered directly rather than through the harness: a `family={undefined}`
    // prop would pick up the harness's default and quietly test nothing.
    render(
      <EstateStep
        value={{}}
        onChange={vi.fn()}
        family={undefined}
        collectsFamily
        onAddFamilyChild={vi.fn()}
      />,
    );

    expect(screen.getByText(QUESTION.guardian)).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /use the schedule we suggest/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: /^mobile$/i })).toHaveLength(2);
    // With no name to use, the primary is addressed generically rather than blank.
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});

describe("EstateStep — the legal-residence question is a tri-state", () => {
  function group() {
    return screen.getByRole("group", { name: "Is this your legal residence?" });
  }

  it("starts with neither Yes nor No selected", () => {
    render(<Harness />);
    const g = group();
    expect(within(g).getByRole("button", { name: "Yes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(g).getByRole("button", { name: "No" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("records nothing for the question until it is answered", () => {
    const onChange = vi.fn();
    render(
      <EstateStep
        value={{}}
        onChange={onChange}
        family={FAMILY_WITH_KIDS}
        collectsFamily
        onAddFamilyChild={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /street address/i }), {
      target: { value: "123 Maple St" },
    });

    const next: EstateSlice = onChange.mock.calls[0][0];
    expect(next?.residence?.isLegalResidence).toBeUndefined();
  });

  it("answering No selects No, not Yes, and asks where instead", () => {
    render(<Harness />);

    expect(
      screen.queryByRole("textbox", { name: /where is your legal residence/i }),
    ).toBeNull();

    fireEvent.click(within(group()).getByRole("button", { name: "No" }));

    const g = group();
    expect(within(g).getByRole("button", { name: "No" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(g).getByRole("button", { name: "Yes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("textbox", { name: /where is your legal residence/i }),
    ).toBeInTheDocument();
  });

  it("answering Yes selects Yes and asks nothing further", () => {
    render(<Harness />);
    fireEvent.click(within(group()).getByRole("button", { name: "Yes" }));

    expect(within(group()).getByRole("button", { name: "Yes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("textbox", { name: /where is your legal residence/i }),
    ).toBeNull();
  });
});

describe("EstateStep — the children's schedule", () => {
  it("shows the suggested terms verbatim, so the client agrees to something specific", () => {
    render(<Harness />);
    expect(
      screen.getByText(
        "One third of the principal at 25, half of the balance at 30, the rest at 35",
      ),
    ).toBeInTheDocument();
  });

  it("only offers the free-text box once 'tell us what you'd prefer' is chosen", () => {
    render(<Harness />);
    expect(screen.queryByRole("textbox", { name: /what you.d prefer/i })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /tell us what you.d prefer/i }));

    expect(
      screen.getByRole("textbox", { name: /what you.d prefer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /tell us what you.d prefer/i }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

/**
 * The beneficiary picklist. The behaviours here are the ones the step could
 * plausibly have got wrong: the children come off the Family step rather than
 * being re-typed, a client is not BEHOLDEN to that list, and a child added
 * mid-question lands on the Family step too rather than in a second, private
 * list the projection never sees.
 */
describe("EstateStep — who inherits", () => {
  function row(name: string | RegExp): HTMLElement {
    return screen.getByRole("checkbox", { name: typeof name === "string" ? new RegExp(name) : name });
  }

  it("offers the Family step's children rather than asking for them again", () => {
    render(<Harness />);
    expect(row("Emma")).toBeInTheDocument();
    expect(row("Jack")).toBeInTheDocument();
    // Nothing is ticked until the client says so.
    expect(row("Emma")).toHaveAttribute("aria-checked", "false");
  });

  it("records a ticked child by their place on the Family step, never by name", () => {
    // A name would break the moment the client went back and fixed a spelling.
    const onChange = vi.fn();
    render(
      <EstateStep
        value={{}}
        onChange={onChange}
        family={FAMILY_WITH_KIDS}
        collectsFamily
        onAddFamilyChild={vi.fn()}
      />,
    );
    fireEvent.click(row("Jack"));
    const next: EstateSlice = onChange.mock.calls[0][0];
    expect(next?.inheritance?.beneficiaries).toEqual([{ ref: "child:1" }]);
  });

  it("drops the spouse from the list once everything goes to them first", () => {
    render(<Harness />);
    expect(row("Bre")).toBeInTheDocument();
    fireEvent.click(
      within(
        screen.getByRole("group", { name: /does everything go to bre first\?/i }),
      ).getByRole("button", { name: "Yes" }),
    );
    expect(screen.queryByRole("checkbox", { name: /Bre/ })).toBeNull();
    expect(screen.getByText("Once you are both gone, who inherits?")).toBeInTheDocument();
  });

  it("adds a child to the FAMILY step, not to a private list of its own", () => {
    // The whole point of writing back: the projection, the goals step and the
    // CRM all see the child. A private estate-only list would show the same kid
    // twice and leave the plan ignorant of their age.
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
    fireEvent.change(screen.getByRole("textbox", { name: /full name/i }), {
      target: { value: "Nora Ruiz" },
    });
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "2022-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // She is on the list, ticked, and reads her age off the date of birth.
    const nora = row("Nora Ruiz");
    expect(nora).toHaveAttribute("aria-checked", "true");
    // And she is a Family-step child — no Remove button, because the Family
    // step owns her.
    expect(within(nora.parentElement as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("will not add a child until both the name and the date of birth are given", () => {
    // A child with no date of birth fails the Family step's own submit
    // validation — long after the client typed it, on a step they never saw.
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /full name/i }), {
      target: { value: "Nora Ruiz" },
    });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "2022-06-01" },
    });
    expect(add).toBeEnabled();
  });

  it("takes somebody the family list does not hold, and lets them be removed again", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add someone else" }));
    fireEvent.change(screen.getByRole("textbox", { name: /full name/i }), {
      target: { value: "Ruth Alvarez" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /relationship to you/i }), {
      target: { value: "my sister" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(row(/Ruth Alvarez/)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("my sister")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove ruth alvarez/i }));
    expect(screen.queryByRole("checkbox", { name: /Ruth Alvarez/ })).toBeNull();
  });

  it("asks how to divide it only once there is more than one person to divide between", () => {
    render(<Harness />);
    const shares = () => screen.queryByText("How much does each of them get?");
    expect(shares()).toBeNull();
    fireEvent.click(row("Emma"));
    expect(shares()).toBeNull();
    fireEvent.click(row("Jack"));
    expect(shares()).toBeInTheDocument();
  });

  it("asks what happens if a beneficiary dies first as soon as one is chosen", () => {
    render(<Harness />);
    expect(screen.queryByRole("radio", { name: /passes to their own children/i })).toBeNull();
    fireEvent.click(row("Emma"));
    expect(
      screen.getByRole("radio", { name: /passes to their own children/i }),
    ).toBeInTheDocument();
  });

  it("keeps a quick-added child out of the Family step on a form that has no Family step", () => {
    // An estate-only form carries no family slice. Writing a child into one
    // would produce a `family` object with no primary, which fails the strict
    // submit schema on a step the client was never shown.
    const onAdd = vi.fn();
    render(
      <EstateStep
        value={{}}
        onChange={vi.fn()}
        family={undefined}
        collectsFamily={false}
        onAddFamilyChild={onAdd}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
    fireEvent.change(screen.getByRole("textbox", { name: /full name/i }), {
      target: { value: "Nora Ruiz" },
    });
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "2022-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).not.toHaveBeenCalled();
  });
});

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
}: {
  family?: Family;
  initial?: EstateSlice;
}) {
  const [value, setValue] = useState<EstateSlice>(initial);
  return <EstateStep value={value} onChange={setValue} family={family} />;
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
    render(<EstateStep value={{}} onChange={vi.fn()} family={undefined} />);

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
    render(<EstateStep value={{}} onChange={onChange} family={FAMILY_WITH_KIDS} />);

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

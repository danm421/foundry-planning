// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData } from "@/engine/types";
import { GuidedTrustWizard } from "../guided-trust-wizard";

const tree = {
  client: {
    firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01",
    spouseName: "Jordan", spouseDob: "1970-03-02",
  },
  accounts: [],
  planSettings: { planStartYear: 2026, planEndYear: 2030 },
  familyMembers: [
    { id: "fm-c", role: "client", relationship: "other", firstName: "Alex", lastName: "Rivera" },
    { id: "fm-s", role: "spouse", relationship: "other", firstName: "Jordan", lastName: "Rivera" },
    { id: "fm-1", role: "child", relationship: "child", firstName: "Sam", lastName: "Rivera" },
    { id: "fm-2", role: "child", relationship: "child", firstName: "Ava", lastName: "Rivera" },
  ],
  externalBeneficiaries: [],
} as unknown as ClientData;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => new Promise(() => {})); // impact stays "loading"
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(cleanup);

function setup(t: ClientData = tree) {
  const onAdd = vi.fn();
  const onCancel = vi.fn();
  render(
    <GuidedTrustWizard
      clientId="c1"
      source="base"
      mutations={[]}
      tree={t}
      revocableTrusts={[]}
      annualExclusionByYear={{ 2026: 19000 }}
      onAdd={onAdd}
      onCancel={onCancel}
    />,
  );
  return { onAdd, onCancel };
}

const click = (name: RegExp | string) => userEvent.click(screen.getByRole("button", { name }));

async function pickSam() {
  const benefits = screen.getByRole("group", { name: /benefits now/i });
  await userEvent.click(within(benefits).getByRole("button", { name: /Sam/ }));
}

async function toReview() {
  await click(/Next: Who it's for/);
  await pickSam();
  await click(/Next: Powers/);
  await click(/Next: Funding/);
  await click(/Next: Review/);
}

describe("GuidedTrustWizard", () => {
  it("starts on Type with Cancel (no Back) and a Next naming the step", () => {
    setup();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Next: Who it's for/ })).toBeEnabled();
  });

  it("Next on Who it's for is disabled with a hint until people are picked", async () => {
    setup();
    await click(/Next: Who it's for/);
    expect(screen.getByRole("button", { name: /Next: Powers/ })).toBeDisabled();
    expect(screen.getByText(/Pick who can benefit/)).toBeInTheDocument();
    await pickSam();
    expect(screen.getByRole("button", { name: /Next: Powers/ })).toBeEnabled();
  });

  it("Cancel emits nothing", async () => {
    const { onAdd, onCancel } = setup();
    await click("Cancel");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Back goes to the previous step", async () => {
    setup();
    await click(/Next: Who it's for/);
    await click(/Back/);
    expect(screen.getByRole("radiogroup", { name: /kind of trust/i })).toBeInTheDocument();
  });

  it("picking Revocable never throws and skips People, Powers and Funding", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: /Revocable/ }));
    expect(screen.getByRole("button", { name: /Next: Accounts/ })).toBeEnabled();
  });

  it("the CRT path shows Setup", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: /^CRT/ }));
    await click(/Next: Setup/);
    expect(screen.getByRole("button", { name: /Back/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next: Review/ })).toBeDisabled();
  });

  it("arrives on Review with the default name filled and fires the impact once", async () => {
    setup();
    await toReview();
    expect(screen.getByLabelText("Name")).toHaveValue("Sam Rivera Irrevocable Trust");
    expect(screen.getByRole("button", { name: "Add trust" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // before + after
    await userEvent.type(screen.getByLabelText("Name"), "!");
    expect(fetchMock).toHaveBeenCalledTimes(2); // typing the name never re-projects
  });

  it("Edit with no change then Back to review does not re-project", async () => {
    setup();
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit Grantor" }));
    await click("Back to review");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Edit that changes the grantor re-projects exactly once more", async () => {
    setup();
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit Grantor" }));
    await userEvent.click(screen.getByRole("radio", { name: "Jordan" }));
    await click("Back to review");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("changing the kind from Review walks the new kind's steps instead of returning", async () => {
    setup();
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit Type" }));
    await userEvent.click(screen.getByRole("radio", { name: /^CRT/ }));
    expect(screen.getByRole("button", { name: /Next: Setup/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to review" })).toBeNull();
  });

  it("Edit from Review -> change grantor -> Back to review returns to Review", async () => {
    setup();
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit Grantor" }));
    await userEvent.click(screen.getByRole("radio", { name: "Jordan" }));
    await click("Back to review");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add trust" })).toBeInTheDocument();
  });

  it("the default name follows the answers until the advisor types one", async () => {
    setup();
    await toReview();
    const name = () => screen.getByLabelText("Name");
    expect(name()).toHaveValue("Sam Rivera Irrevocable Trust");
    const toggleAva = async () => {
      await userEvent.click(screen.getByRole("button", { name: "Edit Gets what's left" }));
      const left = screen.getByRole("group", { name: /gets what's left/i });
      await userEvent.click(within(left).getByRole("button", { name: /Ava/ }));
      await click("Back to review");
    };
    await toggleAva();
    expect(name()).toHaveValue("Rivera Irrevocable Trust");
    await userEvent.clear(name());
    await userEvent.type(name(), "Legacy Trust");
    await toggleAva();
    expect(name()).toHaveValue("Legacy Trust");
  });

  it("numbers a default name another trust has, and blocks Add trust on a typed duplicate", async () => {
    setup({ ...tree, entities: [{ id: "t-old", name: "Sam Rivera Irrevocable Trust" }] } as unknown as ClientData);
    await toReview();
    expect(screen.getByLabelText("Name")).toHaveValue("Sam Rivera Irrevocable Trust 2");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "sam rivera irrevocable trust");
    expect(screen.getByRole("button", { name: "Add trust" })).toBeDisabled();
    expect(
      screen.getByText("A trust named sam rivera irrevocable trust already exists. Pick another name."),
    ).toBeInTheDocument();
  });

  it("Add trust calls onAdd once with the entity first and the answers", async () => {
    const { onAdd } = setup();
    await toReview();
    await click("Add trust");
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [batch, answers] = onAdd.mock.calls[0];
    expect(batch.mutations[0].kind).toBe("entity-upsert");
    expect(answers.name).toBe("Sam Rivera Irrevocable Trust");
  });
});

// @vitest-environment jsdom
//
// The first three wizard steps, as controlled components: each test drives the
// step through a tiny stateful host so what's asserted is what the next render
// would show, plus the last emitted answers.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientData } from "@/engine/types";
import {
  guidedTrustContext,
  initialAnswers,
  type GuidedTrustAnswers,
  type GuidedTrustContext,
} from "@/lib/solver/guided-trust";
import { GuidedTrustTypeStep } from "../guided-trust-type-step";
import { GuidedTrustPeopleStep } from "../guided-trust-people-step";
import { GuidedTrustPowersStep } from "../guided-trust-powers-step";
import { StepBar } from "../guided-trust-ui";

function tree(married = true): ClientData {
  return {
    client: {
      firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01",
      ...(married ? { spouseName: "Jordan", spouseDob: "1970-03-02" } : {}),
    },
    accounts: [],
    planSettings: { planStartYear: 2026, planEndYear: 2030 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Alex", lastName: "Rivera" },
      ...(married
        ? [{ id: "fm-s", role: "spouse", relationship: "other", firstName: "Jordan", lastName: "Rivera" }]
        : []),
      { id: "fm-1", role: "child", relationship: "child", firstName: "Sam", lastName: "Rivera" },
      { id: "fm-2", role: "child", relationship: "child", firstName: "Casey", lastName: "Rivera" },
    ],
    externalBeneficiaries: [],
  } as unknown as ClientData;
}

const ctxFor = (married = true) => guidedTrustContext(tree(married), { 2026: 19000 });

function Host({
  ctx,
  start,
  onEmit,
  children,
}: {
  ctx: GuidedTrustContext;
  start?: Partial<GuidedTrustAnswers>;
  onEmit?: (a: GuidedTrustAnswers) => void;
  children: (p: {
    answers: GuidedTrustAnswers;
    ctx: GuidedTrustContext;
    onChange: (a: GuidedTrustAnswers) => void;
  }) => React.ReactNode;
}) {
  const [answers, setAnswers] = useState<GuidedTrustAnswers>({ ...initialAnswers("e1"), ...start });
  return (
    <>
      {children({
        answers,
        ctx,
        onChange: (a) => {
          setAnswers(a);
          onEmit?.(a);
        },
      })}
    </>
  );
}

describe("StepBar", () => {
  it("marks the current step and numbers the rest", () => {
    render(<StepBar steps={["Type", "Who", "Powers"]} current={1} />);
    expect(screen.getByText("Who").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Type").closest("li")).not.toHaveAttribute("aria-current");
  });
});

describe("GuidedTrustTypeStep", () => {
  it("offers a SLAT only for a married household", () => {
    const { unmount } = render(
      <Host ctx={ctxFor(true)}>{(p) => <GuidedTrustTypeStep {...p} />}</Host>,
    );
    expect(screen.getByRole("radiogroup", { name: /kind of trust/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /SLAT/ })).toBeInTheDocument();
    unmount();
    render(<Host ctx={ctxFor(false)}>{(p) => <GuidedTrustTypeStep {...p} />}</Host>);
    expect(screen.getByRole("radio", { name: /Irrevocable gift trust/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /SLAT/ })).toBeNull();
  });

  it("picking SLAT applies the preset and pre-picks the spouse", async () => {
    const emit = vi.fn();
    render(<Host ctx={ctxFor()} onEmit={emit}>{(p) => <GuidedTrustTypeStep {...p} />}</Host>);
    expect(screen.getByRole("radio", { name: /Irrevocable gift trust/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: /SLAT/ }));
    const next = emit.mock.calls.at(-1)![0] as GuidedTrustAnswers;
    expect(next.kind).toBe("slat");
    expect(next.accessibleToClient).toBe(true);
    expect(next.lifetime).toEqual([{ person: { kind: "household", role: "spouse" }, percentage: 100 }]);
    expect(screen.getByRole("radio", { name: /SLAT/ })).toHaveAttribute("aria-checked", "true");
  });

  it("states the gift trust's tax effect honestly", () => {
    render(<Host ctx={ctxFor()}>{(p) => <GuidedTrustTypeStep {...p} />}</Host>);
    expect(
      screen.getByText(
        "What you give leaves your estate. It uses lifetime exemption, so the saving is on everything it earns afterward.",
      ),
    ).toBeInTheDocument();
  });
});

describe("GuidedTrustPeopleStep", () => {
  const People = (p: Parameters<typeof GuidedTrustPeopleStep>[0] extends infer P ? P : never) => (
    <GuidedTrustPeopleStep {...p} />
  );

  function PeopleHost({ ctx, start, onEmit }: { ctx: GuidedTrustContext; start?: Partial<GuidedTrustAnswers>; onEmit?: (a: GuidedTrustAnswers) => void }) {
    const [touched, setTouched] = useState(false);
    return (
      <Host ctx={ctx} start={start} onEmit={onEmit}>
        {(p) => <People {...p} remainderTouched={touched} onRemainderTouched={() => setTouched(true)} />}
      </Host>
    );
  }

  it("shows the grantor switch only when married", () => {
    const { unmount } = render(<PeopleHost ctx={ctxFor(true)} />);
    const group = screen.getByRole("radiogroup", { name: /grantor/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Alex" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("whose gift funds it")).toBeInTheDocument();
    unmount();
    render(<PeopleHost ctx={ctxFor(false)} />);
    expect(screen.getAllByRole("button", { name: /Sam/ })).toHaveLength(2);
    expect(screen.queryByRole("radiogroup", { name: /grantor/i })).toBeNull();
  });

  it("two children show 50/50, and an edit reaches onChange", async () => {
    const emit = vi.fn();
    render(<PeopleHost ctx={ctxFor()} onEmit={emit} />);
    const benefits = screen.getByRole("group", { name: /benefits now/i });
    await userEvent.click(within(benefits).getByRole("button", { name: /Sam/ }));
    expect(within(benefits).queryByRole("spinbutton")).toBeNull();
    await userEvent.click(within(benefits).getByRole("button", { name: /Casey/ }));
    const boxes = within(benefits).getAllByRole("spinbutton");
    expect(boxes.map((b) => (b as HTMLInputElement).value)).toEqual(["50", "50"]);
    fireEvent.change(boxes[0], { target: { value: "60" } });
    const next = emit.mock.calls.at(-1)![0] as GuidedTrustAnswers;
    expect(next.lifetime.map((s) => s.percentage)).toEqual([60, 50]);
  });

  it("a share box can be cleared and retyped, and takes decimals", async () => {
    const emit = vi.fn();
    render(<PeopleHost ctx={ctxFor()} onEmit={emit} />);
    const benefits = screen.getByRole("group", { name: /benefits now/i });
    await userEvent.click(within(benefits).getByRole("button", { name: /Sam/ }));
    await userEvent.click(within(benefits).getByRole("button", { name: /Casey/ }));
    const box = () => within(benefits).getAllByRole("spinbutton")[0] as HTMLInputElement;
    await userEvent.clear(box());
    expect(box().value).toBe("");
    await userEvent.type(box(), "60");
    expect(box().value).toBe("60");
    expect((emit.mock.calls.at(-1)![0] as GuidedTrustAnswers).lifetime[0].percentage).toBe(60);
    await userEvent.clear(box());
    await userEvent.type(box(), "33.5");
    expect(box().value).toBe("33.5");
    expect((emit.mock.calls.at(-1)![0] as GuidedTrustAnswers).lifetime[0].percentage).toBe(33.5);
    // Leaving a blank box restores the last committed number.
    await userEvent.clear(box());
    await userEvent.tab();
    expect(box().value).toBe("33.5");
  });

  it("remainder follows benefits-now minus the spouse until it is edited", async () => {
    const emit = vi.fn();
    render(<PeopleHost ctx={ctxFor()} onEmit={emit} />);
    const benefits = screen.getByRole("group", { name: /benefits now/i });
    const left = screen.getByRole("group", { name: /gets what's left/i });
    await userEvent.click(within(benefits).getByRole("button", { name: /Jordan/ }));
    await userEvent.click(within(benefits).getByRole("button", { name: /Sam/ }));
    let next = emit.mock.calls.at(-1)![0] as GuidedTrustAnswers;
    expect(next.remainder).toEqual([{ person: { kind: "family_member", id: "fm-1" }, percentage: 100 }]);
    // The remainder list never offers the spouse.
    expect(within(left).queryByRole("button", { name: /Jordan/ })).toBeNull();
    // A direct edit stops the following.
    await userEvent.click(within(left).getByRole("button", { name: /Casey/ }));
    await userEvent.click(within(benefits).getByRole("button", { name: /Casey/ }));
    next = emit.mock.calls.at(-1)![0] as GuidedTrustAnswers;
    expect(next.remainder.map((s) => s.person)).toEqual([
      { kind: "family_member", id: "fm-1" },
      { kind: "family_member", id: "fm-2" },
    ]);
  });

  it("explains a SLAT when the spouse is picked on a non-SLAT type", async () => {
    render(<PeopleHost ctx={ctxFor()} />);
    expect(screen.queryByText(/makes this a SLAT/)).toBeNull();
    await userEvent.click(within(screen.getByRole("group", { name: /benefits now/i })).getByRole("button", { name: /Jordan/ }));
    expect(
      screen.getByText(
        "Naming Jordan as a lifetime beneficiary makes this a SLAT: the couple keeps indirect access to the money, and that access ends if the marriage does.",
      ),
    ).toBeInTheDocument();
  });

  it("no SLAT callout on a SLAT", () => {
    render(
      <PeopleHost
        ctx={ctxFor()}
        start={{ kind: "slat", lifetime: [{ person: { kind: "household", role: "spouse" }, percentage: 100 }] }}
      />,
    );
    expect(screen.queryByText(/makes this a SLAT/)).toBeNull();
  });
});

describe("GuidedTrustPowersStep", () => {
  it("switches write isGrantor / crummeyPowers / accessibleToClient", async () => {
    const emit = vi.fn();
    render(<Host ctx={ctxFor()} onEmit={emit}>{(p) => <GuidedTrustPowersStep {...p} />}</Host>);
    const grantor = screen.getByRole("switch", { name: /Grantor trust/ });
    expect(grantor).toHaveAttribute("aria-checked", "true");
    await userEvent.click(grantor);
    expect(emit.mock.calls.at(-1)![0].isGrantor).toBe(false);
    await userEvent.click(screen.getByRole("switch", { name: /Crummey powers/ }));
    expect(emit.mock.calls.at(-1)![0].crummeyPowers).toBe(false);
    await userEvent.click(screen.getByRole("switch", { name: /Household can draw on it/ }));
    expect(emit.mock.calls.at(-1)![0].accessibleToClient).toBe(true);
  });

  it("the Crummey note names the plan-start-year exclusion", () => {
    render(<Host ctx={ctxFor()}>{(p) => <GuidedTrustPowersStep {...p} />}</Host>);
    expect(screen.getByText(/up to \$19,000 a year per beneficiary/)).toBeInTheDocument();
  });

  it("turn-off year offers Never plus each plan year", async () => {
    const emit = vi.fn();
    render(<Host ctx={ctxFor()} onEmit={emit}>{(p) => <GuidedTrustPowersStep {...p} />}</Host>);
    const select = screen.getByRole("combobox", { name: /turn off in/i });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual([
      "Never", "2026", "2027", "2028", "2029", "2030",
    ]);
    await userEvent.selectOptions(select, "2028");
    expect(emit.mock.calls.at(-1)![0].grantorStatusEndYear).toBe(2028);
    await userEvent.selectOptions(select, "Never");
    expect(emit.mock.calls.at(-1)![0].grantorStatusEndYear).toBeNull();
  });

  it("says what the type turned on, only while the value still matches", async () => {
    render(<Host ctx={ctxFor()}>{(p) => <GuidedTrustPowersStep {...p} />}</Host>);
    expect(screen.getAllByText("On by default for an irrevocable gift trust")).toHaveLength(2);
    await userEvent.click(screen.getByRole("switch", { name: /Crummey powers/ }));
    expect(screen.getAllByText("On by default for an irrevocable gift trust")).toHaveLength(1);
    // Household access is off by default for a gift trust: no line when turned on.
    await userEvent.click(screen.getByRole("switch", { name: /Household can draw on it/ }));
    expect(screen.getAllByText("On by default for an irrevocable gift trust")).toHaveLength(1);
  });

  it("household access is on by default for a SLAT", () => {
    render(
      <Host ctx={ctxFor()} start={{ kind: "slat", accessibleToClient: true }}>
        {(p) => <GuidedTrustPowersStep {...p} />}
      </Host>,
    );
    expect(screen.getByRole("switch", { name: /Household can draw on it/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("On by default for a SLAT")).toHaveLength(3);
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GeneratePanel } from "../generate-panel";
import { MAX_ACTIONS } from "@/lib/insights/schemas";
import type { Signal } from "@/lib/insights/signals";

const sig = (id: string, title: string): Signal => ({
  id,
  domain: "portfolio",
  severity: "opportunity",
  title,
  detail: "d",
  numbers: {},
  href: null,
  estimatedImpact: null,
});

const initial = (over: Partial<Parameters<typeof GeneratePanel>[0]["initial"]> = {}) => ({
  headline: "Cooper household is on track",
  snapshot: "snap",
  goals: "goals",
  actions: [],
  talkingPoints: [],
  generatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("GeneratePanel", () => {
  // `stale` is passed to this component in three other tests and no assertion
  // anywhere consumes it, so seeding the dirty state from `false` instead of the
  // prop would keep the whole suite green while the advisor is served a profile
  // built from superseded plan data with no indication anything moved.
  it("tells the advisor the plan data moved under a stale profile", () => {
    render(<GeneratePanel clientId="c1" stale signals={[]} initial={initial()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/plan data changed/i);
  });

  it("says nothing about stale data when the profile is current", () => {
    render(<GeneratePanel clientId="c1" stale={false} signals={[]} initial={initial()} />);
    expect(screen.getByRole("status")).not.toHaveTextContent(/plan data changed/i);
  });

  /**
   * The signalId join is the whole anti-fabrication contract: an action is only
   * shown against the deterministic signal it cites. Asserting the title sits
   * inside the SAME list item as the recommendation (rather than merely being
   * somewhere on screen) is what pins the join — both strings render either way
   * if the lookup is dropped and the title is printed from a different source.
   */
  it("shows each action against the title of the signal it cites", () => {
    render(
      <GeneratePanel
        clientId="c1"
        stale={false}
        signals={[
          sig("portfolio.cash_drag", "18% of the portfolio is in cash"),
          sig("tax.qcd", "QCD is available at 70 and a half"),
        ]}
        initial={initial({
          actions: [
            { signalId: "tax.qcd", recommendation: "Route the gift as a QCD", why: "why-qcd" },
            {
              signalId: "portfolio.cash_drag",
              recommendation: "Move the excess cash to the model",
              why: "why-cash",
            },
          ],
        })}
      />,
    );

    const first = screen.getByText("Route the gift as a QCD").closest("li")!;
    expect(within(first).getByText("QCD is available at 70 and a half")).toBeInTheDocument();
    expect(within(first).queryByText("18% of the portfolio is in cash")).not.toBeInTheDocument();

    const second = screen.getByText("Move the excess cash to the model").closest("li")!;
    expect(within(second).getByText("18% of the portfolio is in cash")).toBeInTheDocument();
  });

  /** A persisted action can outlive the signal it cites once the data moves on.
   *  It must be labelled, not silently rendered with a blank evidence line. */
  it("labels an action whose cited signal no longer fires", () => {
    render(
      <GeneratePanel
        clientId="c1"
        stale
        signals={[]}
        initial={initial({
          actions: [
            { signalId: "portfolio.cash_drag", recommendation: "Move the cash", why: "w" },
          ],
        })}
      />,
    );

    const item = screen.getByText("Move the cash").closest("li")!;
    expect(within(item).getByText(/No longer flagged/i)).toBeInTheDocument();
  });

  // NOTE: these are two separate renders, not a rerender. `sections` is seeded
  // by `useState(initial)`, which ignores later prop changes, so a rerender
  // would keep showing the first render's actions and the second assertion
  // would pass (or fail) for the wrong reason.
  const renderWithActions = (n: number) => {
    const actions = Array.from({ length: n }, (_, i) => ({
      signalId: `plan.rule_${i}`,
      recommendation: `rec ${i}`,
      why: `why ${i}`,
    }));
    render(
      <GeneratePanel
        clientId="c1"
        stale={false}
        signals={actions.map((a) => sig(a.signalId, `sig ${a.signalId}`))}
        initial={initial({ actions })}
      />,
    );
  };

  it("tells the advisor the action list is capped once it hits MAX_ACTIONS", () => {
    renderWithActions(MAX_ACTIONS);
    expect(screen.getByText(/every signal is listed above/i)).toBeInTheDocument();
  });

  it("makes no capped claim when the list is under MAX_ACTIONS", () => {
    // Nothing was truncated here, so announcing a cap would be a lie.
    renderWithActions(MAX_ACTIONS - 1);
    expect(screen.queryByText(/every signal is listed above/i)).not.toBeInTheDocument();
  });
});

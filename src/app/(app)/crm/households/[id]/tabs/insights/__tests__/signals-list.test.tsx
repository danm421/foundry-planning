// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SignalsList } from "../signals-list";
import type { Signal } from "@/lib/insights/signals";

const sig = (over: Partial<Signal> & Pick<Signal, "id">): Signal => ({
  domain: "plan",
  severity: "critical",
  title: `title ${over.id}`,
  detail: `detail ${over.id}`,
  numbers: {},
  href: null,
  estimatedImpact: null,
  ...over,
});

describe("SignalsList", () => {
  it("renders the empty state when no signal fired", () => {
    render(<SignalsList signals={[]} />);
    expect(screen.getByText(/Nothing needs attention/i)).toBeInTheDocument();
  });

  it("groups signals under their severity heading with a count", () => {
    render(
      <SignalsList
        signals={[
          sig({ id: "plan.a", severity: "critical" }),
          sig({ id: "plan.b", severity: "critical" }),
          sig({ id: "risk.c", severity: "watch" }),
        ]}
      />,
    );

    const critical = screen.getByText("Needs attention").closest("section")!;
    const watch = screen.getByText("Worth watching").closest("section")!;

    // Membership, not just presence: a signal rendered under the wrong heading
    // is exactly the bug this pins.
    expect(within(critical).getByText("title plan.a")).toBeInTheDocument();
    expect(within(critical).getByText("title plan.b")).toBeInTheDocument();
    expect(within(critical).queryByText("title risk.c")).not.toBeInTheDocument();
    expect(within(watch).getByText("title risk.c")).toBeInTheDocument();
    expect(within(critical).getByText("2")).toBeInTheDocument();
  });

  /**
   * The ordering contract. `orderSignals` has already sorted the array and
   * `hashBattery` hashes that order, so the UI must render it as given.
   *
   * The fixture is deliberately asymmetric: within one severity the given order
   * (zzz, aaa, mmm) differs from id-ascending (aaa, mmm, zzz), from
   * impact-descending (aaa, mmm, zzz) AND from impact-ascending (zzz, mmm, aaa).
   * Any re-sort the component might introduce therefore changes the DOM order —
   * a symmetric fixture would silently agree with a re-sort and pin nothing.
   */
  it("renders signals in the order given, never re-sorting them", () => {
    render(
      <SignalsList
        signals={[
          sig({ id: "plan.zzz", title: "Zed signal", estimatedImpact: 10 }),
          sig({ id: "plan.aaa", title: "Ann signal", estimatedImpact: 500 }),
          sig({ id: "plan.mmm", title: "Mid signal", estimatedImpact: 100 }),
        ]}
      />,
    );

    // getAllByText returns matches in document order.
    const rendered = screen.getAllByText(/ signal$/).map((el) => el.textContent);
    expect(rendered).toEqual(["Zed signal", "Ann signal", "Mid signal"]);
    // Sanity: the given order is not any of the orders a stray sort would
    // produce (id asc and impact desc both give Ann, Mid, Zed; impact asc
    // gives Zed, Mid, Ann), so this assertion genuinely discriminates.
  });

  it("links a signal that carries an href, naming it for screen readers", () => {
    render(
      <SignalsList
        signals={[
          sig({ id: "risk.no_profile", title: "No risk profile on file", href: "/risk/c1" }),
          sig({ id: "plan.no_link", title: "Nowhere to go" }),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: "Open No risk profile on file" });
    expect(link).toHaveAttribute("href", "/risk/c1");
    // The href-less signal must not render a second, destination-less link.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

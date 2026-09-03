// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PresentationsLauncher } from "../launcher";
import { draftKey } from "@/components/presentations/launcher/use-launcher-draft";
import { OBSERVATIONS_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/pages/observations-next-steps/options-schema";

const originalFetch = global.fetch;
const originalCreateObjectURL = global.URL.createObjectURL;
const originalRevokeObjectURL = global.URL.revokeObjectURL;
beforeEach(() => {
  // The launcher now auto-persists the in-progress deck to localStorage
  // (useLauncherDraft). Clear it between tests so a deck mutated by one test
  // (e.g. "remove all pages") isn't restored into the next one.
  localStorage.clear();
  // jsdom implements neither — the per-page Download path calls both.
  global.URL.createObjectURL = vi.fn(() => "blob:mock");
  global.URL.revokeObjectURL = vi.fn();
  global.fetch = vi.fn(async (url: string) => {
    // download=1 streams a real PDF blob back for a direct browser download.
    if (String(url).includes("/presentations/runs") && String(url).includes("download=1")) {
      return new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200 });
    }
    if (String(url).includes("/presentations/runs")) {
      return new Response(JSON.stringify({ runId: "r1" }), { status: 202 });
    }
    if (String(url).includes("/generation-runs")) {
      return new Response(JSON.stringify({ householdId: "hh-test", runs: [] }), { status: 200 });
    }
    if (String(url).includes("/presentations/export-pdf")) {
      return new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
        status: 200,
      });
    }
    if (url === "/api/presentation-templates") {
      return new Response(
        JSON.stringify({ shared: [], mine: [], builtIn: [], builtInHidden: [] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as never;
});
afterEach(() => {
  global.fetch = originalFetch;
  global.URL.createObjectURL = originalCreateObjectURL;
  global.URL.revokeObjectURL = originalRevokeObjectURL;
});

describe("PresentationsLauncher", () => {
  it("pre-selects Cover + TOC + Cash Flow on empty state and renders Generate enabled", () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    expect(screen.getByText("Cover Sheet")).toBeInTheDocument();
    expect(screen.getByText("Table of Contents")).toBeInTheDocument();
    expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: /Generate PDF/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("disables Generate when all pages are removed", () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove Cover Sheet"));
    fireEvent.click(screen.getByLabelText("Remove Table of Contents"));
    fireEvent.click(screen.getByLabelText("Remove Cash Flow"));
    expect(
      (screen.getByRole("button", { name: /Generate PDF/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("opens a per-report preview that POSTs preview=true with a single page", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview Cash Flow/i }));
    await screen.findByTitle(/preview$/i);
    const exportCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("export-pdf"));
    expect(exportCall).toBeTruthy();
    const body = JSON.parse((exportCall![1] as RequestInit).body as string);
    expect(body.preview).toBe(true);
    expect(body.pages).toHaveLength(1);
  });

  it("opens a whole-deck preview that POSTs all pages", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview full/i }));
    await screen.findByTitle(/Full presentation preview/i);
    const exportCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("export-pdf"));
    const body = JSON.parse((exportCall![1] as RequestInit).body as string);
    expect(body.preview).toBe(true);
    expect(body.pages.length).toBeGreaterThan(1);
  });

  it("per-page Download streams the PDF for a direct download (download=1)", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Download Cash Flow/i }));
    await waitFor(() => {
      const dlCall = vi
        .mocked(global.fetch)
        .mock.calls.find((c) => String(c[0]).includes("download=1"));
      expect(dlCall).toBeTruthy();
      expect((dlCall![1] as RequestInit).method).toBe("POST");
    });
    // A blob URL was created → a direct browser download was triggered.
    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  });

  it("blocks Generate and warns when a Retirement Comparison page has no comparison selected", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    // Add a Retirement Comparison page (defaults to no comparison scenario).
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "retirement comparison" },
    });
    fireEvent.click(screen.getByText("Retirement Comparison"));

    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));

    // A warning names the page and the export is blocked (no runs POST).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no comparison selected/i);
    const runsCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("/presentations/runs"));
    expect(runsCall).toBeUndefined();
  });

  it("blocks Generate and warns when a Plan Comparison page has no comparison selected", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    // Add a Plan Comparison page (defaults to no comparison scenario).
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "plan comparison" },
    });
    fireEvent.click(screen.getByText("Plan Comparison"));

    // The row offers the inline "Compare to…" picker, never a base-facts override.
    expect(screen.getByLabelText(/Comparison scenario for Plan Comparison/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^Scenario for Plan Comparison$/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no comparison selected for plan comparison/i);
    const runsCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("/presentations/runs"));
    expect(runsCall).toBeUndefined();
  });

  it("blocks Generate and warns when a Scenario Comparison page has no scenario chosen", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    // Add a Scenario Comparison page (defaults to an empty scenarioIds list).
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "scenario comparison" },
    });
    fireEvent.click(screen.getByText("Scenario Comparison"));

    // No inline picker for this page — its scenario list lives in Options.
    expect(screen.queryByLabelText(/Comparison scenario for Scenario Comparison/i)).toBeNull();
    expect(screen.queryByLabelText(/^Scenario for Scenario Comparison$/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));

    // The isUnconfigured branch's wording points at Options, not an inline
    // dropdown this page doesn't have — and the export is still blocked.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no scenario chosen for scenario comparison/i);
    expect(alert).toHaveTextContent(/open options and choose at least one scenario/i);
    const runsCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("/presentations/runs"));
    expect(runsCall).toBeUndefined();
  });

  it("blocks Generate and shows the section hint when Observations & Next Steps has both sections off", async () => {
    // Seed a pre-configured page directly into the launcher's draft storage
    // rather than opening the Options dialog — the dialog's Options control
    // isn't wired to a scenario-comparison-style query in this test harness,
    // and the draft-restore path (useLauncherDraft) is exactly how the real
    // launcher would carry an advisor's saved-off deck across a reload.
    localStorage.setItem(
      draftKey("c1", "me"),
      JSON.stringify({
        v: 1,
        state: {
          topScenarioPickerValue: "base",
          filename: "",
          pages: [
            {
              pageId: "observationsNextSteps",
              options: { ...OBSERVATIONS_PAGE_OPTIONS_DEFAULT, showObservations: false, showNextSteps: false },
              scenarioOverride: undefined,
            },
          ],
          loadedTemplate: null,
          isModified: false,
        },
      }),
    );
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    // The restore effect hydrates the seeded draft in after mount.
    await screen.findByText("Observations & Next Steps");

    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/turn on at least one section/i);
    const runsCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("/presentations/runs"));
    expect(runsCall).toBeUndefined();
  });

  it("pre-warms base + each chosen scenario for a configured Scenario Comparison page", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[{ id: "s1", name: "Scenario One", isBaseCase: false }]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "scenario comparison" },
    });
    fireEvent.click(screen.getByText("Scenario Comparison"));

    // Choose one scenario through the Options dialog — the pre-warm effect
    // reads scenarioIds off the deck's live state, not a fixture.
    fireEvent.click(screen.getByRole("button", { name: "Options for Scenario Comparison" }));
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    fireEvent.change(screen.getByLabelText("Scenario 1"), { target: { value: "s1" } });

    // The effect debounces 600ms before firing; wait past it for the warm POST.
    await waitFor(
      () => {
        const warmCalls = vi
          .mocked(global.fetch)
          .mock.calls.filter((c) => String(c[0]).includes("/presentations/warm"));
        expect(warmCalls).toHaveLength(1);
        expect(JSON.parse((warmCalls[0][1] as RequestInit).body as string)).toEqual({
          scenarioId: "s1",
          targetPoS: 0.85,
        });
      },
      { timeout: 2000 },
    );
  });

  it("pre-warms with no max-spend solve when the page's Max Spend toggle is off", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[{ id: "s1", name: "Scenario One", isBaseCase: false }]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add page/i }));
    fireEvent.change(screen.getByPlaceholderText(/search reports/i), {
      target: { value: "scenario comparison" },
    });
    fireEvent.click(screen.getByText("Scenario Comparison"));

    fireEvent.click(screen.getByRole("button", { name: "Options for Scenario Comparison" }));
    // Turn Max Spend off BEFORE choosing the scenario, so only one settled
    // (scenarioId,targetPoS) key is ever debounced — the pre-warm effect's own
    // dedup keys on both, and toggling after would fire a second warm POST
    // under the old `targetPoS: 0.85` key.
    fireEvent.click(screen.getByLabelText(/solves each column.s sustainable spending/i));
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    fireEvent.change(screen.getByLabelText("Scenario 1"), { target: { value: "s1" } });

    await waitFor(
      () => {
        const warmCalls = vi
          .mocked(global.fetch)
          .mock.calls.filter((c) => String(c[0]).includes("/presentations/warm"));
        expect(warmCalls).toHaveLength(1);
        expect(JSON.parse((warmCalls[0][1] as RequestInit).body as string)).toEqual({
          scenarioId: "s1",
          targetPoS: null,
        });
      },
      { timeout: 2000 },
    );
  });

  it("Generate posts to the background /presentations/runs route and shows a notice", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));
    await waitFor(() => {
      const runsCall = vi
        .mocked(global.fetch)
        .mock.calls.find((c) => String(c[0]).includes("/presentations/runs"));
      expect(runsCall).toBeTruthy();
      expect((runsCall![1] as RequestInit).method).toBe("POST");
    });
    // success notice is specific to the generate flow (not the "Recent runs" panel heading)
    await screen.findByText(/Generating your presentation/i);
    // The default mocked /presentations/runs response (above) carries no
    // storyReview — no deck here has a Plan Story page, so the soft gate has
    // nothing to warn about.
    expect(screen.queryByText(/haven't been reviewed yet/i)).not.toBeInTheDocument();
  });

  // The soft export gate (Task 16). The 202 response `handleGenerate` already
  // reads is the only place in production that both (a) knows the unreviewed
  // count and (b) fires before the file exists — see the ruling recorded
  // against Task 16's report: the preview dialog fetches `export-pdf`, which
  // streams a PDF and can never carry this, so it cannot be the surface.
  it("surfaces the soft gate's warning in the run-progress notice when chapters are unreviewed", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/presentations/runs") && !String(url).includes("download=1")) {
        return new Response(
          JSON.stringify({
            runId: "r1",
            storyReview: [
              { pageId: "planStory", scenarioId: "base", documentRole: "standalone", unreviewed: 8, total: 12 },
            ],
          }),
          { status: 202 },
        );
      }
      if (String(url).includes("/generation-runs")) {
        return new Response(JSON.stringify({ householdId: "hh-test", runs: [] }), { status: 200 });
      }
      if (url === "/api/presentation-templates") {
        return new Response(
          JSON.stringify({ shared: [], mine: [], builtIn: [], builtInHidden: [] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as never;

    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));
    // The export still ran (soft — never blocked) AND the warning is shown.
    await screen.findByText(/Generating your presentation/i);
    await screen.findByText(/8 of 12 Plan Story chapters haven't been reviewed yet\./i);
  });

  // The Early Years flat-chart note rides the SAME 202 and lands in the same
  // status region — one warning surface, not a second one per feature.
  it("surfaces the flat-chart note in the run-progress notice", async () => {
    const NOTE = "“What Saving More Is Worth” will read nearly flat for this plan: no living expense is set to spend whatever’s left each year.";
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/presentations/runs") && !String(url).includes("download=1")) {
        return new Response(JSON.stringify({ runId: "r1", ladderWarning: NOTE }), { status: 202 });
      }
      if (String(url).includes("/generation-runs")) {
        return new Response(JSON.stringify({ householdId: "hh-test", runs: [] }), { status: 200 });
      }
      if (url === "/api/presentation-templates") {
        return new Response(
          JSON.stringify({ shared: [], mine: [], builtIn: [], builtInHidden: [] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as never;

    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        householdId="hh-test"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [], builtIn: [], builtInHidden: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate PDF/i }));
    // Soft, like the story gate beside it: the export still ran.
    await screen.findByText(/Generating your presentation/i);
    await screen.findByText(/will read nearly flat for this plan/i);
  });
});

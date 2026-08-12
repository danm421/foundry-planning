// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PlanStoryReviewPanel } from "@/components/presentations/pages/plan-story/review-panel";

interface Row {
  chapterId: string;
  title: string;
  text: string;
  generated: boolean;
  edited: boolean;
  aiSuppressed: boolean;
  error: string | null;
  reviewed: boolean;
}

const CHAPTERS: Row[] = [
  {
    chapterId: "planInOnePage",
    title: "Your plan, in one page",
    text: "Your plan holds.",
    generated: true,
    edited: false,
    aiSuppressed: false,
    error: null,
    reviewed: false,
  },
  {
    chapterId: "whatWeRecommend",
    title: "What we're recommending, and why",
    text: "",
    generated: false,
    edited: false,
    aiSuppressed: false,
    error: null,
    reviewed: false,
  },
];

/** The two frozen constants `story/generate.ts` writes to `error` (:28, :32).
 *  Spelled out here rather than imported: that module reaches Azure and Redis,
 *  which a jsdom component test must not pull in. */
const UNAVAILABLE = "The writing assistant was unavailable.";
const TOO_SHORT = "The writing assistant returned too little text to use.";

function stubFetch(chapters: Row[], getStatus = 200) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH" || init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ scenarioId: "base", chapters }), {
      status: getStatus,
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function calls() {
  return (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

function patchCalls() {
  return calls().filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH");
}

beforeEach(() => {
  stubFetch(CHAPTERS);
  // The panel logs every failed request. Silenced so a deliberate failure in a
  // test does not read as a real one in the run output.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlanStoryReviewPanel", () => {
  it("lists every chapter with its text", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    expect(await screen.findByText("Your plan, in one page")).toBeTruthy();
    expect(await screen.findByDisplayValue("Your plan holds.")).toBeTruthy();
  });

  it("shows a not-generated chapter as awaiting generation", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    expect(await screen.findByText(/not generated/i)).toBeTruthy();
  });

  it("saves an edit back to the chapter route", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const box = await screen.findByDisplayValue("Your plan holds.");
    fireEvent.change(box, { target: { value: "My own words." } });
    fireEvent.blur(box);
    await waitFor(() => {
      const patch = calls().find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toContain("/plan-story/planInOnePage");
      expect(String((patch![1] as RequestInit).body)).toContain("My own words.");
    });
  });

  it("does not re-save a chapter the advisor only clicked into", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const box = await screen.findByDisplayValue("Your plan holds.");
    fireEvent.blur(box);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(calls().some((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")).toBe(
      false,
    );
  });

  it("shows what the save stored, not what was typed", async () => {
    // Emptying the box is a real instruction: the row drops the advisor's
    // version and resolves back to the model's words. The box has to follow the
    // row, or it shows blank while the report prints prose.
    const model = { ...CHAPTERS[0], text: "The model's words.", edited: true };
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        model.edited = false;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ scenarioId: "base", chapters: [model] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fn);

    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const box = await screen.findByDisplayValue("The model's words.");
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(calls().some((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")).toBe(
        true,
      ),
    );
    expect(await screen.findByDisplayValue("The model's words.")).toBeTruthy();
  });

  it("keeps the advisor's words in the box when the save is refused", async () => {
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: "Nope" }), { status: 500 });
      }
      return new Response(JSON.stringify({ scenarioId: "base", chapters: CHAPTERS }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fn);

    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const box = await screen.findByDisplayValue("Your plan holds.");
    fireEvent.change(box, { target: { value: "My own words." } });
    fireEvent.blur(box);
    await waitFor(() =>
      expect(calls().some((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")).toBe(
        true,
      ),
    );
    // A refused save must not quietly restore the stored text over words the
    // advisor can no longer see to retype.
    expect(await screen.findByDisplayValue("My own words.")).toBeTruthy();
  });

  it("marks a chapter reviewed", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const buttons = await screen.findAllByRole("button", { name: /mark reviewed/i });
    fireEvent.click(buttons[0]);
    await waitFor(() => {
      expect(
        calls().some((c) =>
          String((c[1] as RequestInit | undefined)?.body ?? "").includes('"reviewed":true'),
        ),
      ).toBe(true);
    });
  });

  it("shows the unreviewed count so the export gate has something to read", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    expect(await screen.findByText(/2 chapters not yet reviewed/i)).toBeTruthy();
  });

  it("never claims every chapter is reviewed when the chapters could not be loaded", async () => {
    stubFetch(CHAPTERS, 500);
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(screen.queryByText(/all chapters reviewed/i)).toBeNull();
  });

  it("asks the routes for the base story rather than an empty scenario", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="" documentRole="standalone" />);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(String(calls()[0][0])).toContain("scenarioId=base");
  });

  it("generates only when asked, and sends the scenario and register it is showing", async () => {
    render(
      <PlanStoryReviewPanel clientId="c1" scenarioId="scenario-7" documentRole="frontMatter" />,
    );
    await screen.findByText("Your plan, in one page");
    expect(calls().some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => {
      const post = calls().find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain("/plan-story/generate");
      expect(String((post![1] as RequestInit).body)).toContain('"scenarioId":"scenario-7"');
      // The Executive brief preset's whole behaviour. This panel is the generate
      // route's only production caller, so a body without it leaves the model
      // writing self-contained chapters for the front of a longer deck — and the
      // route's own default is the value that hides it.
      expect(String((post![1] as RequestInit).body)).toContain('"documentRole":"frontMatter"');
    });
  });

  it("speaks the unreviewed count, which changes under the advisor", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const summary = await screen.findByText(/2 chapters not yet reviewed/i);
    expect(summary.getAttribute("aria-live")).toBe("polite");
  });

  describe("a request that did not do what it said", () => {
    it("tells the advisor when the chapters could not be loaded", async () => {
      stubFetch(CHAPTERS, 500);
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /couldn't load this report's chapters/i,
      );
    });

    it("tells the advisor when a dropped connection killed the request", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      );
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
      expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't load/i);
    });

    it("tells the advisor when a save was refused, instead of looking saved", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) =>
          init?.method === "PATCH"
            ? new Response(JSON.stringify({ error: "Nope" }), { status: 500 })
            : new Response(JSON.stringify({ scenarioId: "base", chapters: CHAPTERS }), {
                status: 200,
              }),
        ),
      );
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
      const box = await screen.findByDisplayValue("Your plan holds.");
      fireEvent.change(box, { target: { value: "My own words." } });
      fireEvent.blur(box);
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /couldn't save your edit/i,
      );
    });

    it("tells the advisor when nothing was generated, rather than resetting the button", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) =>
          init?.method === "POST"
            ? new Response(JSON.stringify({ error: "Nope" }), { status: 500 })
            : new Response(JSON.stringify({ scenarioId: "base", chapters: CHAPTERS }), {
                status: 200,
              }),
        ),
      );
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
      fireEvent.click(await screen.findByRole("button", { name: /generate all/i }));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /nothing was generated/i,
      );
    });

    it("takes the message back down once a retry works", async () => {
      let refuse = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === "PATCH") {
            const res = new Response(JSON.stringify({ ok: !refuse }), {
              status: refuse ? 500 : 200,
            });
            refuse = false;
            return res;
          }
          return new Response(JSON.stringify({ scenarioId: "base", chapters: CHAPTERS }), {
            status: 200,
          });
        }),
      );
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
      const box = await screen.findByDisplayValue("Your plan holds.");
      fireEvent.change(box, { target: { value: "My own words." } });
      fireEvent.blur(box);
      await screen.findByRole("alert");
      fireEvent.blur(box);
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
  });

  it("will not write a chapter twice when Mark reviewed is double-clicked", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    const button = (await screen.findAllByRole("button", { name: /mark reviewed/i }))[0];
    fireEvent.click(button);
    // Marking reviewed cannot be undone from any surface and files an audit row
    // per call, so the second click must land on a disabled control.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    await waitFor(() => expect(patchCalls().length).toBeGreaterThan(0));
    expect(patchCalls().length).toBe(1);
  });

  describe("why a chapter is missing", () => {
    function renderWith(overrides: Partial<Row>) {
      stubFetch([{ ...CHAPTERS[0], ...overrides }]);
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" documentRole="standalone" />);
    }

    it("says the assistant did not answer when the call failed", async () => {
      renderWith({ aiSuppressed: true, error: UNAVAILABLE });
      expect(await screen.findByText(/didn't answer/i)).toBeTruthy();
      expect(screen.queryByText(/too little/i)).toBeNull();
    });

    it("says the assistant replied with too little when it returned a stub", async () => {
      renderWith({ aiSuppressed: true, error: TOO_SHORT });
      expect(await screen.findByText(/too little to use/i)).toBeTruthy();
      expect(screen.queryByText(/didn't answer/i)).toBeNull();
    });

    it("gives no failure reason when the gates suppressed clean prose", async () => {
      renderWith({ aiSuppressed: true, error: null });
      expect(await screen.findByText(/written from plan figures/i)).toBeTruthy();
      expect(screen.queryByText(/writing assistant/i)).toBeNull();
    });

    it("shows an unrecognised reason as stored rather than swallowing it", async () => {
      renderWith({ aiSuppressed: true, error: "The plan has no figures to quote." });
      expect(await screen.findByText("The plan has no figures to quote.")).toBeTruthy();
    });
  });
});

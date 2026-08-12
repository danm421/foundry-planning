// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => {
  stubFetch(CHAPTERS);
});

describe("PlanStoryReviewPanel", () => {
  it("lists every chapter with its text", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
    expect(await screen.findByText("Your plan, in one page")).toBeTruthy();
    expect(await screen.findByDisplayValue("Your plan holds.")).toBeTruthy();
  });

  it("shows a not-generated chapter as awaiting generation", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
    expect(await screen.findByText(/not generated/i)).toBeTruthy();
  });

  it("saves an edit back to the chapter route", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
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
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
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

    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
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

    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
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
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
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
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
    expect(await screen.findByText(/2 chapters not yet reviewed/i)).toBeTruthy();
  });

  it("never claims every chapter is reviewed when the chapters could not be loaded", async () => {
    stubFetch(CHAPTERS, 500);
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(screen.queryByText(/all chapters reviewed/i)).toBeNull();
  });

  it("asks the routes for the base story rather than an empty scenario", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="" />);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(String(calls()[0][0])).toContain("scenarioId=base");
  });

  it("generates only when asked, and sends the scenario it is showing", async () => {
    render(<PlanStoryReviewPanel clientId="c1" scenarioId="scenario-7" />);
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
    });
  });

  describe("why a chapter is missing", () => {
    function renderWith(overrides: Partial<Row>) {
      stubFetch([{ ...CHAPTERS[0], ...overrides }]);
      render(<PlanStoryReviewPanel clientId="c1" scenarioId="base" />);
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

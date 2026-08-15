// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PlanStoryReviewPanel } from "@/components/presentations/pages/plan-story/review-panel";
import { MAX_PARAGRAPHS } from "@/lib/presentations/pages/plan-story/view-model";
// A pure function over two string unions — no Azure and no Redis, unlike the
// `generate.ts` constants spelled out below. Imported rather than restated
// because it is the ONE spelling of "every chapter at the default", and a
// second copy here would pass while the panel sent something else.
import { resolveChapterStyles } from "@/lib/presentations/story/types";

interface Row {
  chapterId: string;
  title: string;
  text: string;
  generated: boolean;
  edited: boolean;
  aiSuppressed: boolean;
  error: string | null;
  reviewed: boolean;
  /** Whether a generation could write this chapter for this story — decided by
   *  the route, never by the panel, so it is a FIXTURE value here. Both rows
   *  below say yes; the row that says no has its own tests. */
  candidate?: boolean;
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
    candidate: true,
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
    candidate: true,
  },
];

/** The two frozen constants `story/generate.ts` writes to `error` (:28, :32).
 *  Spelled out here rather than imported: that module reaches Azure and Redis,
 *  which a jsdom component test must not pull in. */
const UNAVAILABLE = "The writing assistant was unavailable.";
const TOO_SHORT = "The writing assistant returned too little text to use.";

/**
 * The staleness endpoint is a SECOND request, deliberately — see the panel's own
 * comment. Any stub that asserts on a badge has to answer it; the stubs that do
 * not fall through to the chapter-list payload, whose missing `stale` key reads
 * as "nothing is out of date". So a badge assertion added to one of THOSE would
 * prove nothing — answer this endpoint explicitly there too.
 */
const isStaleUrl = (url: unknown) => String(url).includes("/plan-story/stale");

/** The two READ legs every stub in this file has to answer — the chapter list,
 *  and the staleness check that is deliberately a second request. One copy, so
 *  a third read leg is added once rather than in every stub below. */
function answerRead(url: string, chapters: Row[] = CHAPTERS, stale: string[] = [], status = 200) {
  if (isStaleUrl(url)) return new Response(JSON.stringify({ stale }), { status: 200 });
  return new Response(JSON.stringify({ scenarioId: "base", chapters }), { status });
}

function stubFetch(chapters: Row[], getStatus = 200, stale: string[] = []) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH" || init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return answerRead(url, chapters, stale, getStatus);
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

function staleCalls() {
  return calls().filter((c) => isStaleUrl(c[0]));
}

function postCalls() {
  return calls().filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
}

/** The first generation request's body. `chapterStyle` is spelled out because
 *  the style tests read into it — *sends the row's tone and length with a
 *  Regenerate* and *sends the style with a whole-run Generate all too*;
 *  everything else stays `unknown`. */
function postBody() {
  return JSON.parse(String((postCalls()[0][1] as RequestInit).body)) as {
    chapterStyle: Record<string, { tone: string; length: string }>;
    [key: string]: unknown;
  };
}

function row(title: string): HTMLElement {
  return screen.getByRole("region", { name: title });
}

/**
 * The file's ONE render site.
 *
 * Both style props are REQUIRED on the panel — it may not invent a style the
 * page will not print — so without this every test below would spell the full
 * prop list out, and the next required prop would be a 48-site edit.
 *
 * Returns the EFFECTIVE style callback, not the spy it made: a test that passes
 * its own would otherwise assert on a function the panel never received.
 */
function renderPanel(overrides: Partial<ComponentProps<typeof PlanStoryReviewPanel>> = {}) {
  const base: ComponentProps<typeof PlanStoryReviewPanel> = {
    clientId: "c1",
    scenarioId: "base",
    documentRole: "standalone",
    chapterStyle: {},
    onChapterStyleChange: vi.fn(),
  };
  const view = render(<PlanStoryReviewPanel {...base} {...overrides} />);
  return {
    onChapterStyleChange: { ...base, ...overrides }.onChapterStyleChange,
    /**
     * The same panel with new props IN PLACE, rather than a second mount. The
     * only way to prove a style change re-checks staleness without clearing the
     * drafts: a remount clears them anyway, so it would pass either way.
     *
     * ⚠️ `overrides` is re-applied UNDER `next`, so a test that rendered with a
     * scenario and then rerenders only a style keeps that scenario. Without it
     * the rerender silently reverts to `base` on every prop it does not name.
     */
    rerender: (next: Partial<ComponentProps<typeof PlanStoryReviewPanel>>) =>
      view.rerender(<PlanStoryReviewPanel {...base} {...overrides} {...next} />),
  };
}

/**
 * A story where `stale` chapters are out of date and a Generate run rewrites
 * only `written` — the shape that separates "the run cleared this badge" from
 * "the panel cleared them all".
 */
function generatingOnly(written: string[], stale: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ chapters: written.map((chapterId) => ({ chapterId })) }), {
          status: 200,
        });
      }
      return answerRead(url, CHAPTERS, stale);
    }),
  );
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
    renderPanel();
    expect(await screen.findByText("Your plan, in one page")).toBeTruthy();
    expect(await screen.findByDisplayValue("Your plan holds.")).toBeTruthy();
  });

  it("shows a not-generated chapter as awaiting generation", async () => {
    renderPanel();
    expect(await screen.findByText(/not generated/i)).toBeTruthy();
  });

  it("saves an edit back to the chapter route", async () => {
    renderPanel();
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
    renderPanel();
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

    renderPanel();
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

    renderPanel();
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
    renderPanel();
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
    renderPanel();
    expect(await screen.findByText(/2 chapters not yet reviewed/i)).toBeTruthy();
  });

  it("never claims every chapter is reviewed when the chapters could not be loaded", async () => {
    stubFetch(CHAPTERS, 500);
    renderPanel();
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(screen.queryByText(/all chapters reviewed/i)).toBeNull();
  });

  it("asks the routes for the base story rather than an empty scenario", async () => {
    renderPanel({ scenarioId: "" });
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(String(calls()[0][0])).toContain("scenarioId=base");
  });

  it("generates only when asked, and sends the scenario and register it is showing", async () => {
    renderPanel({ scenarioId: "scenario-7", documentRole: "frontMatter" });
    await screen.findByText("Your plan, in one page");
    expect(calls().some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(
      false,
    );
    // Named exactly: every row now carries a Regenerate button too, and a loose
    // /generate/i matches those as well.
    fireEvent.click(screen.getByRole("button", { name: /generate all/i }));
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
    renderPanel();
    const summary = await screen.findByText(/2 chapters not yet reviewed/i);
    expect(summary.getAttribute("aria-live")).toBe("polite");
  });

  describe("a request that did not do what it said", () => {
    it("tells the advisor when the chapters could not be loaded", async () => {
      stubFetch(CHAPTERS, 500);
      renderPanel();
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
      renderPanel();
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
      renderPanel();
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
      renderPanel();
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
      renderPanel();
      const box = await screen.findByDisplayValue("Your plan holds.");
      fireEvent.change(box, { target: { value: "My own words." } });
      fireEvent.blur(box);
      await screen.findByRole("alert");
      fireEvent.blur(box);
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
  });

  /**
   * ⭐ Fourteen rows, one message. An advisor saves down the list, so a failure
   * that any later success wipes out is a failure they never see — while the
   * unsaved words sit in the box looking exactly like saved ones.
   */
  describe("a failure belongs to the chapter it happened to", () => {
    const A = "Your plan, in one page";
    const B = "What we're recommending, and why";

    /** A's saves are refused; B's land. `stillRefusing` lets one case relent on
     *  the retry. */
    function refuseA(stillRefusing = () => true) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "PATCH") {
            const refused = String(url).includes("planInOnePage") && stillRefusing();
            return new Response(JSON.stringify({ ok: !refused }), { status: refused ? 500 : 200 });
          }
          if (isStaleUrl(url)) return new Response(JSON.stringify({ stale: [] }), { status: 200 });
          return new Response(JSON.stringify({ scenarioId: "base", chapters: CHAPTERS }), {
            status: 200,
          });
        }),
      );
    }

    async function saveInto(title: string, text: string) {
      const box = await screen.findByLabelText(`${title} text`);
      fireEvent.change(box, { target: { value: text } });
      fireEvent.blur(box);
    }

    it("keeps a failed save visible when another chapter then succeeds", async () => {
      refuseA();
      renderPanel();
      await saveInto(A, "my words for A");
      await screen.findByRole("alert");
      await saveInto(B, "my words for B");
      await waitFor(() => expect(patchCalls().length).toBe(2));

      expect(within(row(A)).getByRole("alert").textContent).toMatch(/couldn't save your edit/i);
      // …and the words it is about are still there to retry with.
      expect(within(row(A)).getByRole("textbox")).toHaveProperty("value", "my words for A");
    });

    it("never shows one chapter's failure against another", async () => {
      refuseA();
      renderPanel();
      await saveInto(A, "my words for A");
      await screen.findByRole("alert");

      expect(within(row(B)).queryByRole("alert")).toBeNull();
    });

    it("takes a chapter's own message down once that chapter saves", async () => {
      let refuse = true;
      refuseA(() => {
        const refused = refuse;
        refuse = false;
        return refused;
      });
      renderPanel();
      await saveInto(A, "first try");
      await screen.findByRole("alert");
      await saveInto(A, "second try");

      await waitFor(() => expect(within(row(A)).queryByRole("alert")).toBeNull());
    });
  });

  /**
   * ⭐ The badge, and the cost that shapes it. Answering "which chapters were
   * written from a plan that has since moved" rebuilds the whole story context —
   * MEASURED at 23.2s cold, 4.0s warm — so it is a separate request asked once,
   * and its answer is held in the panel's own state.
   */
  describe("chapters the plan has moved underneath", () => {
    it("says so on the chapter the check named", async () => {
      stubFetch(CHAPTERS, 200, ["planInOnePage"]);
      renderPanel();
      expect(
        within(await screen.findByRole("region", { name: "Your plan, in one page" })).getByText(
          /plan has changed since/i,
        ),
      ).toBeTruthy();
      // Kills: rendering the note on every row. The advisor has to be able to
      // tell which chapter needs regenerating.
      expect(within(row("What we're recommending, and why")).queryByText(/plan has changed/i)).toBeNull();
    });

    it("says nothing when no chapter is out of date", async () => {
      stubFetch(CHAPTERS, 200, []);
      renderPanel();
      await screen.findByText("Your plan, in one page");
      expect(screen.queryByText(/plan has changed since/i)).toBeNull();
    });

    /**
     * ⚠️⚠️ Kills: moving the flag onto the chapter list. The panel reloads that
     * list after EVERY save, so the badge would blink off the moment an advisor
     * edited anything — and each blur would wait on a plan rebuild.
     */
    it("survives a save, and does not run again on one", async () => {
      stubFetch(CHAPTERS, 200, ["planInOnePage"]);
      renderPanel();
      const box = await screen.findByDisplayValue("Your plan holds.");
      fireEvent.change(box, { target: { value: "my words" } });
      fireEvent.blur(box);
      await waitFor(() => expect(patchCalls().length).toBe(1));

      expect(screen.getByText(/plan has changed since/i)).toBeTruthy();
      expect(staleCalls().length).toBe(1);
    });

    /**
     * ⭐ The one other moment the answer moves — and it is answered from the
     * run's own response, not by asking again. The generate route already
     * rebuilt the plan and stored the hash it read; asking the staleness route
     * afterwards would rebuild the very same plan a second time, 4s warm and
     * 23s cold, on the end of a wait the advisor is already sitting through.
     */
    it("takes the badge down for a chapter the run rewrote, without a second rebuild", async () => {
      generatingOnly(["planInOnePage"], ["planInOnePage", "whatWeRecommend"]);
      renderPanel();
      await screen.findAllByText(/plan has changed since/i);
      fireEvent.click(screen.getByRole("button", { name: /generate all/i }));

      await waitFor(() =>
        expect(within(row("Your plan, in one page")).queryByText(/plan has changed/i)).toBeNull(),
      );
      expect(staleCalls().length).toBe(1);
    });

    // …and only those. A chapter the run skipped — nothing to recommend, no data
    // behind it — was not rewritten, so if it was out of date it still is.
    it("leaves the badge on a chapter the run did not write", async () => {
      generatingOnly(["planInOnePage"], ["planInOnePage", "whatWeRecommend"]);
      renderPanel();
      await screen.findAllByText(/plan has changed since/i);
      fireEvent.click(screen.getByRole("button", { name: /generate all/i }));

      await waitFor(() =>
        expect(within(row("Your plan, in one page")).queryByText(/plan has changed/i)).toBeNull(),
      );
      expect(
        within(row("What we're recommending, and why")).getByText(/plan has changed/i),
      ).toBeTruthy();
    });

    /**
     * A check that fails leaves the panel exactly as it was: the badge is advice
     * about freshness, and every chapter is still readable, editable and
     * saveable without it. It must not raise the alarm that means "your chapters
     * did not load".
     *
     * ⚠️ The stale answer is deliberately settled on a TIMER, one macrotask
     * behind the chapter list. Both requests go out together on mount, and the
     * list's own success clears the panel message on its way in — so without the
     * delay a panel that DID raise the alarm has it wiped before this can look,
     * and the test passes on a bug. The console line is the synchronisation
     * point: it only runs once the failure has actually been handled.
     */
    it("stays quiet when the check itself fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (isStaleUrl(url)) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
          }
          return new Response(JSON.stringify({ scenarioId: "base", chapters: CHAPTERS }), {
            status: 200,
          });
        }),
      );
      renderPanel();
      await waitFor(() =>
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("out of date"),
          expect.anything(),
        ),
      );

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/plan has changed since/i)).toBeNull();
    });
  });

  /**
   * ⭐ Regenerate — the only control in the app that spends model calls on ONE
   * chapter, and the reason `force` is reachable at all. Every case here is
   * about a click that costs money: what it asks for, what it does when the
   * firm's ceiling refuses it, and what a second click cannot do.
   */
  describe("rewriting one chapter", () => {
    const A = "Your plan, in one page";
    const B = "What we're recommending, and why";

    /** The generate route, refusing with `status` and (for a ceiling) the wait
     *  its `Retry-After` header names. */
    function refuseGeneration(status: number, retryAfter?: string) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) =>
          init?.method === "POST"
            ? new Response(JSON.stringify({ error: "no" }), {
                status,
                headers: retryAfter ? { "retry-after": retryAfter } : {},
              })
            : answerRead(url),
        ),
      );
    }

    async function clickRegenerate(title: string) {
      const button = within(await screen.findByRole("region", { name: title })).getByRole(
        "button",
        { name: /^regenerate$/i },
      );
      fireEvent.click(button);
      return button as HTMLButtonElement;
    }

    // Kills: sending the row's id without `force`. The 30-day AI cache cannot be
    // deleted from any surface, so a Regenerate that reads it returns the very
    // words the advisor pressed the button to replace.
    it("asks for that chapter alone, past the cache", async () => {
      renderPanel({ scenarioId: "", documentRole: "frontMatter" });
      await clickRegenerate(A);
      await waitFor(() => expect(postCalls().length).toBe(1));
      expect(String(postCalls()[0][0])).toContain("/plan-story/generate");
      expect(postBody()).toEqual({
        scenarioId: "base",
        documentRole: "frontMatter",
        chapterId: "planInOnePage",
        force: true,
        // The advisor has restyled nothing here, so this is every chapter at the
        // default. Still SENT rather than left off: the route hashes what it was
        // told, and the exact match is what keeps a fifth field from arriving
        // unnoticed.
        chapterStyle: resolveChapterStyles({}),
      });
    });

    // Kills: a Regenerate that quietly runs the whole story. The button sits on
    // one row, and fourteen chapters is twenty-eight model calls.
    it("leaves every other chapter alone", async () => {
      renderPanel();
      await clickRegenerate(B);
      await waitFor(() => expect(postCalls().length).toBe(1));
      expect(postBody().chapterId).toBe("whatWeRecommend");
    });

    /**
     * ⭐ The ceiling, in the advisor's words. A firm over its budget is not a
     * broken button: nothing is wrong, the answer is to wait — and a message
     * that cannot say that gets pressed again immediately.
     */
    it("names the wait against that row when the firm is over its ceiling", async () => {
      refuseGeneration(429, "45");
      renderPanel();
      await clickRegenerate(A);
      const alert = await within(row(A)).findByRole("alert");
      expect(alert.textContent).toMatch(/45 seconds/i);
      // …and against THAT row, not the panel and not its neighbour.
      expect(within(row(B)).queryByRole("alert")).toBeNull();
    });

    // Kills: showing the wait for every failure. A 500 is not something waiting
    // fixes, and an advisor told to wait for it waits forever.
    it("does not blame the ceiling for a failure that is not one", async () => {
      refuseGeneration(500);
      renderPanel();
      await clickRegenerate(A);
      const alert = await within(row(A)).findByRole("alert");
      expect(alert.textContent).toMatch(/couldn't rewrite/i);
      expect(alert.textContent).not.toMatch(/seconds/i);
    });

    // Kills: leaving the button live while the request is in flight. Each click
    // is a model call the firm pays for, and the wait is measured in tens of
    // seconds — long enough that a second click is the natural thing to do.
    it("cannot be pressed twice into the same chapter", async () => {
      renderPanel();
      const button = await clickRegenerate(A);
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      await waitFor(() => expect(postCalls().length).toBe(1));
    });

    // Kills: clearing every row's badge, or none. The run rewrote this chapter
    // from the plan as it stands now — and touched nothing else.
    it("takes the out-of-date badge down for the chapter it rewrote, and only that one", async () => {
      stubFetch(CHAPTERS, 200, ["planInOnePage", "whatWeRecommend"]);
      renderPanel();
      await screen.findAllByText(/plan has changed since/i);
      await clickRegenerate(A);

      await waitFor(() => expect(within(row(A)).queryByText(/plan has changed/i)).toBeNull());
      expect(within(row(B)).getByText(/plan has changed/i)).toBeTruthy();
      // Kills: re-asking the staleness route afterwards, which rebuilds the very
      // plan this run just read — 4s warm, 23s cold, on the end of a wait the
      // advisor has already sat through.
      expect(staleCalls().length).toBe(1);
    });

    /**
     * The same ceiling, from the other button — and the one more likely to trip
     * it, since a whole run is the more expensive of the two. Kills: leaving
     * "Generate all" with the generic message, which reads as a glitch and gets
     * pressed again straight away.
     */
    it("names the wait for a whole story too, without blaming a chapter", async () => {
      refuseGeneration(429, "30");
      renderPanel();
      fireEvent.click(await screen.findByRole("button", { name: /generate all/i }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/30 seconds/i);
      // …and against the panel, not a row: no single chapter failed.
      expect(within(row(A)).queryByRole("alert")).toBeNull();
    });

    /**
     * ⭐ The rows a base-only report can only refuse — the five proposal
     * chapters. There is nothing the advisor can do to make the button work, so
     * it is not offered rather than offered and answered with an error.
     */
    describe("a chapter this story cannot write", () => {
      const cannot = [CHAPTERS[0], { ...CHAPTERS[1], candidate: false }];

      function regenerateIn(title: string) {
        return within(row(title)).queryByRole("button", { name: /^regenerate$/i });
      }

      // Kills: rendering the button on every row regardless — the click it
      // invites is refused, and the refusal is the only thing that explains it.
      it("offers no Regenerate button", async () => {
        stubFetch(cannot);
        renderPanel();
        await screen.findByRole("region", { name: B });
        expect(regenerateIn(B)).toBeNull();
        // …and only that row. Kills: hiding the button once any row cannot be
        // written, which would take the feature off the whole panel.
        expect(regenerateIn(A)).toBeTruthy();
      });

      // Kills: hiding the row, or standing it down entirely. Nothing can WRITE
      // this chapter, but the advisor's own words in the box still print — the
      // stored edit wins over the model's text at export — and the export gate
      // still counts this row as one they have to read.
      it("still takes the advisor's own words, and still has to be reviewed", async () => {
        stubFetch(cannot);
        renderPanel();
        const section = await screen.findByRole("region", { name: B });
        expect(within(section).getByRole("button", { name: /mark reviewed/i })).toBeTruthy();
        const box = within(section).getByRole("textbox");
        fireEvent.change(box, { target: { value: "What I'd tell them myself." } });
        fireEvent.blur(box);
        await waitFor(() => expect(patchCalls().length).toBe(1));
        expect(String((patchCalls()[0][1] as RequestInit).body)).toContain(
          "What I'd tell them myself.",
        );
      });

      /**
       * ⚠️ The flag has to FAIL OPEN. It arrives as JSON off a route the panel
       * cannot type-check, so a payload without it — a renamed field, a listing
       * written before this shipped — must show every button and let the route
       * refuse, never silently take Regenerate off all fourteen rows.
       *
       * Kills: `!row.candidate`, which reads a missing field as "cannot write".
       */
      it("keeps every button when the list does not answer the question", async () => {
        stubFetch(
          CHAPTERS.map((r) => {
            const noFlag = { ...r };
            delete noFlag.candidate;
            return noFlag;
          }),
        );
        renderPanel();
        await screen.findByRole("region", { name: B });
        expect(regenerateIn(A)).toBeTruthy();
        expect(regenerateIn(B)).toBeTruthy();
      });
    });

    // Kills: leaving the advisor's unsaved words shadowing the prose that just
    // replaced them — a box that looks like the new chapter is not the one that
    // prints.
    it("shows the new words rather than the ones it replaced", async () => {
      const model = { ...CHAPTERS[0], text: "Your plan holds." };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "POST") {
            model.text = "Rewritten from the plan as it stands.";
            return new Response(JSON.stringify({ chapters: [{ chapterId: "planInOnePage" }] }), {
              status: 200,
            });
          }
          return answerRead(url, [model]);
        }),
      );
      renderPanel();
      const box = await screen.findByDisplayValue("Your plan holds.");
      fireEvent.change(box, { target: { value: "words I typed but never saved" } });
      await clickRegenerate(A);
      expect(
        await screen.findByDisplayValue("Rewritten from the plan as it stands."),
      ).toBeTruthy();
    });
  });

  it("will not write a chapter twice when Mark reviewed is double-clicked", async () => {
    renderPanel();
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
      renderPanel();
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

/**
 * Keeping an advisor's own edit as an exemplar of how they write.
 *
 * Two things carry the weight here. The CONSENT sentence: a harvested sample is
 * one household's prose kept to shape another household's report, and it is
 * stored switched off — an advisor who presses the button and reads nothing
 * about what happens next has not been asked. And the REFUSAL: a chapter may
 * hold 20,000 characters, a stored sample 2,000, so the first long chapter
 * anyone presses this on comes back a 400 and the panel has to say why.
 */
describe("saving a chapter as a voice sample", () => {
  const EDITED: Row = {
    ...CHAPTERS[0],
    edited: true,
    text: "The plan holds, and here is the part I always say out loud.",
  };
  const HARVEST = "Save as a voice sample";
  const isHarvestUrl = (url: unknown) => String(url).includes("/api/story-voice/samples");

  /** The chapter list plus an answer for the harvest POST. */
  function stubHarvest(rows: Row[], harvestResponse: () => Response) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && isHarvestUrl(url)) return harvestResponse();
      if (init?.method) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return answerRead(url, rows);
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  const ok = () => new Response(JSON.stringify({ id: "s1", text: "scrubbed" }), { status: 200 });
  const refusesLength = () =>
    new Response(
      JSON.stringify({ error: "Validation failed", issues: [{ path: "text", message: "Too big" }] }),
      { status: 400 },
    );

  it("is offered only on a chapter the advisor has rewritten", async () => {
    stubHarvest([EDITED, CHAPTERS[1]], ok);
    renderPanel();
    await screen.findByText(EDITED.title);
    // The generated chapter's own words are the model's. Keeping those as an
    // exemplar of how this advisor writes would teach it to copy itself.
    expect(within(row(EDITED.title)).getByRole("button", { name: HARVEST })).toBeTruthy();
    expect(within(row(CHAPTERS[1].title)).queryByRole("button", { name: HARVEST })).toBeNull();
  });

  it("sends the words on screen, the chapter, and the household they came from", async () => {
    stubHarvest([EDITED], ok);
    renderPanel();
    const box = await screen.findByDisplayValue(EDITED.text);
    // An unsaved draft is what the advisor is looking at, so it is what a button
    // beside it has to store.
    fireEvent.change(box, { target: { value: "Words I have not saved yet." } });
    fireEvent.click(within(row(EDITED.title)).getByRole("button", { name: HARVEST }));

    await waitFor(() => {
      const post = calls().find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST" && isHarvestUrl(c[0]),
      );
      expect(post).toBeTruthy();
      const body = String((post![1] as RequestInit).body);
      expect(body).toContain("Words I have not saved yet.");
      expect(body).toContain('"sourceChapterId":"planInOnePage"');
      expect(body).toContain('"sourceClientId":"c1"');
    });
  });

  it("says it is saved and off until the advisor turns it on", async () => {
    stubHarvest([EDITED], ok);
    renderPanel();
    await screen.findByText(EDITED.title);
    fireEvent.click(within(row(EDITED.title)).getByRole("button", { name: HARVEST }));
    const status = await within(row(EDITED.title)).findByRole("status");
    expect(status.textContent).toBe(
      "Saved to your voice samples. It's off until you turn it on in Settings → Voice.",
    );
  });

  it("names the limit and the length when the chapter is too long to keep", async () => {
    const long = { ...EDITED, text: "x".repeat(2500) };
    stubHarvest([long], refusesLength);
    renderPanel();
    await screen.findByText(long.title);
    fireEvent.click(within(row(long.title)).getByRole("button", { name: HARVEST }));

    const alert = await within(row(long.title)).findByRole("alert");
    expect(alert.textContent).toContain("2,500 characters");
    expect(alert.textContent).toContain("at most 2,000");
    // A refusal is not a lost chapter: the panel-level alarm means "your
    // chapters did not load", and the other thirteen are untouched.
    expect(screen.queryByText(/Couldn't load this report/)).toBeNull();
  });

  it("reports the refusal against that chapter and leaves the others clean", async () => {
    stubHarvest([EDITED, CHAPTERS[1]], () => new Response("no", { status: 500 }));
    renderPanel();
    await screen.findByText(EDITED.title);
    fireEvent.click(within(row(EDITED.title)).getByRole("button", { name: HARVEST }));
    await waitFor(() => {
      expect(within(row(EDITED.title)).getByRole("alert").textContent).toContain(
        "Nothing was stored",
      );
    });
    expect(within(row(CHAPTERS[1].title)).queryByRole("alert")).toBeNull();
  });

  it("drops the confirmation once the words it named have changed", async () => {
    stubHarvest([EDITED], ok);
    renderPanel();
    const box = await screen.findByDisplayValue(EDITED.text);
    fireEvent.click(within(row(EDITED.title)).getByRole("button", { name: HARVEST }));
    await within(row(EDITED.title)).findByRole("status");
    // "Saved to your voice samples" was about the passage as it stood. Once the
    // box holds something else, the sentence is about words that are not there.
    fireEvent.change(box, { target: { value: "Different words entirely." } });
    expect(within(row(EDITED.title)).queryByRole("status")).toBeNull();
  });

  it("is dead while a whole run is going", async () => {
    // A harvest mid-"Generate all" stores the words the run is about to
    // overwrite — and `generateAll` then clears the confirmation that would have
    // named them, so the advisor is left with a stored passage and no record of
    // it. Regenerate and Mark reviewed are gated on the same states.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        // The generate run never answers, so the panel stays busy.
        if (init?.method === "POST" && !isHarvestUrl(url)) return new Promise<Response>(() => {});
        if (init?.method) return new Response(JSON.stringify({ ok: true }), { status: 200 });
        return answerRead(url, [EDITED]);
      }),
    );
    renderPanel();
    await screen.findByText(EDITED.title);
    const harvestButton = within(row(EDITED.title)).getByRole("button", { name: HARVEST });
    expect((harvestButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Generate all" }));
    await waitFor(() => expect((harvestButton as HTMLButtonElement).disabled).toBe(true));
  });

  // Found by mutation: swapping the CATCH branch's `setProblems` for a
  // panel-level message left every test green, because every other case here
  // fails with an HTTP status rather than by throwing. A dropped connection is
  // the commonest of the two in the field.
  it("reports a dropped connection against that chapter too", async () => {
    stubHarvest([EDITED], () => {
      throw new Error("network down");
    });
    renderPanel();
    await screen.findByText(EDITED.title);
    fireEvent.click(within(row(EDITED.title)).getByRole("button", { name: HARVEST }));
    await waitFor(() => {
      expect(within(row(EDITED.title)).getByRole("alert").textContent).toContain(
        "Nothing was stored",
      );
    });
    expect(screen.queryByText(/Couldn't load this report/)).toBeNull();
  });

  it("will not store the same passage twice on a double click", async () => {
    stubHarvest([EDITED], ok);
    renderPanel();
    await screen.findByText(EDITED.title);
    const button = within(row(EDITED.title)).getByRole("button", { name: HARVEST });
    fireEvent.click(button);
    // Each press writes a row and files an audit entry.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    await within(row(EDITED.title)).findByRole("status");
    expect(calls().filter((c) => isHarvestUrl(c[0])).length).toBe(1);
  });
});

/**
 * The advisor's register and how much prose to ask for, per chapter.
 *
 * ⚠️ The style is an input to every chapter's stored `sourceHash`, so it has to
 * reach BOTH transports: the generate POST that writes the hash, and the
 * staleness GET that rebuilds it. A style on one and not the other is a chapter
 * that reads permanently out of date with nothing able to clear it — which is
 * why the two are tested separately here rather than through one another.
 */
describe("the advisor's tone and length", () => {
  const A = "Your plan, in one page";

  /** A checklist chapter — one of the two `full` cannot move. */
  const NEXT_STEPS: Row = {
    chapterId: "whatHappensNext",
    title: "What happens next",
    text: "Alan opens the Roth.",
    generated: true,
    edited: false,
    aiSuppressed: false,
    error: null,
    reviewed: false,
    candidate: true,
  };

  function toneSelect(title: string): HTMLSelectElement {
    return within(row(title)).getByLabelText("Tone") as HTMLSelectElement;
  }

  function lengthSelect(title: string): HTMLSelectElement {
    return within(row(title)).getByLabelText("Length") as HTMLSelectElement;
  }

  it("sends the row's tone and length with a Regenerate", async () => {
    renderPanel({ chapterStyle: { planInOnePage: { tone: "direct", length: "short" } } });
    await screen.findByText(A);
    fireEvent.click(within(row(A)).getByRole("button", { name: /^regenerate$/i }));
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(postBody().chapterStyle.planInOnePage).toEqual({ tone: "direct", length: "short" });
  });

  /**
   * ⭐ The button an advisor presses FIRST, and the one the brief did not pin.
   * A whole run that omits the style writes fourteen chapters in the default
   * voice and stores fourteen default-style hashes — so every restyled chapter
   * then reads stale, and regenerating it one at a time is the only way out.
   */
  it("sends the style with a whole-run Generate all too", async () => {
    renderPanel({ chapterStyle: { planInOnePage: { tone: "plain", length: "full" } } });
    await screen.findByText(A);
    fireEvent.click(screen.getByRole("button", { name: "Generate all" }));
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(postBody().chapterStyle.planInOnePage).toEqual({ tone: "plain", length: "full" });
    // …and the thirteen the advisor never touched, at the default. The route
    // fills its own gaps, but only from what it was SENT.
    expect(postBody().chapterStyle.thingsToKnow).toEqual({ tone: "warm", length: "standard" });
  });

  // Kills: keeping the style in panel-local state. It would look right on
  // screen and print wrong — the style lives in the PAGE'S OPTIONS, which is
  // what survives a reload and what the export reads.
  it("reports a style change up rather than storing it locally", async () => {
    const { onChapterStyleChange } = renderPanel();
    await screen.findByText(A);
    fireEvent.change(toneSelect(A), { target: { value: "plain" } });
    expect(onChapterStyleChange).toHaveBeenCalledWith("planInOnePage", {
      tone: "plain",
      length: "standard",
    });
  });

  // The other half of the same pair: changing the length must not reset the
  // tone the advisor already picked.
  it("keeps the tone when only the length moves", async () => {
    const { onChapterStyleChange } = renderPanel({
      chapterStyle: { planInOnePage: { tone: "direct", length: "standard" } },
    });
    await screen.findByText(A);
    fireEvent.change(lengthSelect(A), { target: { value: "short" } });
    expect(onChapterStyleChange).toHaveBeenCalledWith("planInOnePage", {
      tone: "direct",
      length: "short",
    });
  });

  it("asks the staleness route about every chapter, in the style it is showing", async () => {
    renderPanel({ chapterStyle: { planInOnePage: { tone: "direct", length: "short" } } });
    await waitFor(() => expect(staleCalls().length).toBe(1));
    const styles = new URL(
      String(staleCalls()[0][0]),
      "http://localhost",
    ).searchParams.getAll("style");
    // All fourteen: the route resolves an absent chapter to the default, but the
    // run stored a hash for one it was TOLD about, so the two agree only when
    // the panel names them.
    expect(styles).toHaveLength(14);
    expect(styles).toContain("planInOnePage:direct:short");
    expect(styles).toContain("thingsToKnow:warm:standard");
  });

  /**
   * ⚠️⚠️ The trap this split was written for. `load()` and `loadOutOfDate()` ran
   * from ONE effect whose body also cleared the drafts, so adding the style to
   * that effect's deps wiped the advisor's unsaved typing on every tone change.
   */
  it("re-checks staleness on a style change without touching unsaved words", async () => {
    const { rerender } = renderPanel();
    await screen.findByText(A);
    const box = within(row(A)).getByRole("textbox");
    fireEvent.change(box, { target: { value: "Half a sentence the advisor is still" } });
    await waitFor(() => expect(staleCalls().length).toBe(1));

    rerender({ chapterStyle: { planInOnePage: { tone: "direct", length: "short" } } });

    // Asked again, in the new style…
    await waitFor(() => expect(staleCalls().length).toBe(2));
    expect(String(staleCalls()[1][0])).toContain("planInOnePage%3Adirect%3Ashort");
    // …and the words in the box are still theirs.
    expect((box as HTMLTextAreaElement).value).toBe("Half a sentence the advisor is still");
    // Kills a re-fetch of the chapter list: that is what replaces the box's text
    // with the stored row, and it has no business running on a tone change.
    expect(calls().filter((c) => !isStaleUrl(c[0]) && c[1] === undefined).length).toBe(1);
  });

  // Kills: re-firing the request on a re-render that changed nothing. The panel
  // keys the check on a query STRING, so a parent handing it a fresh object of
  // equal content must not spend another twenty seconds.
  it("does not re-ask when the style is re-created with the same values", async () => {
    const { rerender } = renderPanel({ chapterStyle: { planInOnePage: { tone: "plain", length: "full" } } });
    await waitFor(() => expect(staleCalls().length).toBe(1));
    rerender({ chapterStyle: { planInOnePage: { tone: "plain", length: "full" } } });
    await waitFor(() => expect(screen.getByText(A)).toBeTruthy());
    expect(staleCalls().length).toBe(1);
  });

  /**
   * ⭐ `full` is a SILENT NO-OP on the two fixed-shape chapters — the prompt and
   * the `sourceHash` come out byte-identical to `standard`. The option is not
   * removed and not disabled: the report-level control sets all fourteen at
   * once, so these rows legitimately HOLD `full`, and a `<select>` whose value is
   * absent from its options shows the wrong one selected. So it is ANNOTATED.
   */
  it("says so on a chapter whose shape Full cannot change", async () => {
    stubFetch([NEXT_STEPS]);
    renderPanel({ chapterStyle: { whatHappensNext: { tone: "warm", length: "full" } } });
    await screen.findByText(NEXT_STEPS.title);
    expect(within(row(NEXT_STEPS.title)).getByText(/reads the same as Standard/i)).toBeTruthy();
    // The option is still THERE and still selected — removing it would show the
    // advisor a different length from the one the deck stored.
    expect(lengthSelect(NEXT_STEPS.title).value).toBe("full");
    expect(
      Array.from(lengthSelect(NEXT_STEPS.title).options).map((o) => o.value),
    ).toEqual(["short", "standard", "full"]);
  });

  it("keeps that note off the row until Full is actually picked", async () => {
    stubFetch([NEXT_STEPS]);
    renderPanel();
    await screen.findByText(NEXT_STEPS.title);
    expect(within(row(NEXT_STEPS.title)).queryByText(/reads the same as Standard/i)).toBeNull();
  });

  // …and never on a chapter Full really does move.
  it("does not claim Full is inert on an ordinary chapter", async () => {
    renderPanel({ chapterStyle: { planInOnePage: { tone: "warm", length: "full" } } });
    await screen.findByText(A);
    expect(within(row(A)).queryByText(/reads the same as Standard/i)).toBeNull();
  });

  /**
   * The five proposal chapters of a base-only report have no Regenerate button
   * at all. They still PRINT, and the advisor still exports them — so the style
   * that decides how they read has to be settable on them.
   */
  it("offers the selects on a row this story cannot rewrite", async () => {
    stubFetch([CHAPTERS[0], { ...CHAPTERS[1], candidate: false }]);
    renderPanel();
    await screen.findByText(CHAPTERS[1].title);
    expect(within(row(CHAPTERS[1].title)).queryByRole("button", { name: /^regenerate$/i })).toBeNull();
    expect(toneSelect(CHAPTERS[1].title)).toBeTruthy();
    expect(lengthSelect(CHAPTERS[1].title)).toBeTruthy();
  });

  // A real `<label for>` rather than an `aria-label`, the rule the scenario
  // picker already follows: it names the control to a screen reader AND gives
  // the caption a click target. The chapter it belongs to comes from the row's
  // own region name.
  it("names each select with a real label", async () => {
    renderPanel();
    await screen.findByText(A);
    const tone = toneSelect(A);
    expect(tone.getAttribute("aria-label")).toBeNull();
    expect(row(A).querySelector(`label[for="${tone.id}"]`)?.textContent).toBe("Tone");
  });
});

/**
 * The whole story, end to end — what the client will read, in the order the
 * report prints it, instead of fourteen separate edit boxes.
 *
 * Two things it exists to prove, and neither is about layout:
 *
 * 1. It shows the STORED words. What prints is what is stored, so a read-through
 *    carrying an unsaved keystroke would certify prose the export will never
 *    use.
 * 2. It applies NONE of the sheet's drop rules. `MAX_PARAGRAPHS` and
 *    `restatesCard` decide what one printed sheet holds; this view is not
 *    paginated, so a chapter reads here in full even when its sheet will not
 *    hold all of it.
 */
describe("the whole story, read through", () => {
  const OPEN = /read it through/i;

  function whole(): HTMLElement {
    return screen.getByRole("article", { name: /the whole story/i });
  }

  /** Wait for the chapters, then switch the panel into the reading view. */
  async function readThrough() {
    await screen.findByText(CHAPTERS[0].title);
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
  }

  it("reads the whole story through, in document order, with nothing editable", async () => {
    renderPanel();
    await readThrough();

    // Every chapter's words, in the order the report prints them…
    expect(within(whole()).getAllByRole("heading").map((h) => h.textContent)).toEqual(
      CHAPTERS.map((c) => c.title),
    );
    // …and not one control the advisor could type into by accident.
    expect(within(whole()).queryAllByRole("textbox")).toHaveLength(0);
  });

  /**
   * The one thing this view must not do: an unsaved edit is not what prints, and
   * a read-through showing it would certify words the export will never use.
   *
   * ⚠️⚠️ `fireEvent.change`, and the choice is not the file's idiom talking — it
   * is the only spelling that can FAIL. `userEvent.type` focuses the box and
   * `userEvent.click` on the toggle then blurs it, which fires the panel's own
   * save; `patch` reloads and drops the draft, so by the time the assertion runs
   * there is no unsaved edit left for a wrong implementation to leak. Measured:
   * with the read-through mutated to `drafts[row.chapterId] ?? row.text`, the
   * `userEvent` version PASSED and this one fails.
   */
  it("shows the stored words, not an unsaved edit", async () => {
    renderPanel();
    const box = await screen.findByLabelText(`${CHAPTERS[0].title} text`);
    fireEvent.change(box, { target: { value: `${CHAPTERS[0].text} AND SOMETHING UNSAVED` } });
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    // The draft is still unsaved — nothing blurred the box — so a read-through
    // that read `drafts` would show it.
    expect(patchCalls()).toHaveLength(0);
    expect(whole()).not.toHaveTextContent("UNSAVED");
  });

  /**
   * …and withholding the draft is not the same as discarding it. The panel's own
   * save path is what normally rescues an edit here — a click on the toggle
   * blurs the box first — so this is the other branch: a draft that reached
   * state without a blur is still in its box on the way back.
   */
  it("hands an unsaved edit back to its box on the way out of the reading view", async () => {
    renderPanel();
    const box = await screen.findByLabelText(`${CHAPTERS[0].title} text`);
    const typed = `${CHAPTERS[0].text} AND SOMETHING UNSAVED`;
    fireEvent.change(box, { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    fireEvent.click(screen.getByRole("button", { name: /back to editing/i }));

    expect(patchCalls()).toHaveLength(0);
    expect((screen.getByLabelText(`${CHAPTERS[0].title} text`) as HTMLTextAreaElement).value).toBe(
      typed,
    );
  });

  it("splits the stored prose into paragraphs and prints no markdown", async () => {
    stubFetch([
      { ...CHAPTERS[0], text: "**Alan** retires at 62.\n\n## What that means\n\nThe plan holds." },
    ]);
    renderPanel();
    await readThrough();

    expect(Array.from(whole().querySelectorAll("p")).map((p) => p.textContent)).toEqual([
      "Alan retires at 62.",
      "What that means",
      "The plan holds.",
    ]);
  });

  /**
   * ⚠️ `MAX_PARAGRAPHS` imported rather than restated, and imported HERE rather
   * than into the panel: it is the measured ceiling of one printed sheet, and a
   * literal copied into this file would go on passing after the sheet was
   * remeasured. The panel must not import it at all — that ceiling is a
   * pagination decision, and this view is not paginated.
   */
  it("reads a chapter past what its sheet will hold rather than dropping paragraphs", async () => {
    const over = MAX_PARAGRAPHS + 4;
    stubFetch([
      {
        ...CHAPTERS[0],
        text: Array.from({ length: over }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n"),
      },
    ]);
    renderPanel();
    await readThrough();

    expect(whole().querySelectorAll("p")).toHaveLength(over);
    expect(within(whole()).getByText(`Paragraph ${over}.`)).toBeTruthy();
  });

  /**
   * Five of the fourteen chapters can never be written for a base-only report,
   * and a chapter can be emptied on purpose. A heading with nothing under it
   * reads as a rendering failure — it has to say which it is.
   */
  it("says so where a chapter has nothing to read yet", async () => {
    renderPanel();
    await readThrough();
    const blank = within(whole()).getByRole("heading", { name: CHAPTERS[1].title })
      .parentElement as HTMLElement;
    expect(within(blank).getByText(/nothing written/i)).toBeTruthy();
  });
});

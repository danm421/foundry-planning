// src/components/forge/__tests__/forge-panel-knowledge-hub.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ScenarioDrawerProvider } from "@/components/scenario/scenario-drawer-provider";
import { ForgeProvider } from "../forge-provider";
import { ForgePanel } from "../forge-panel";
import { stubMediaElements } from "./media-stubs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/details/income-expenses",
  useSearchParams: () => new URLSearchParams("scenario=s1"),
}));
vi.mock("../actions", () => ({
  listMyConversations: vi.fn(async () => []),
  loadConversationMessages: vi.fn(async () => ({ messages: [], approval: null })),
  resolveBaseScenarioId: vi.fn(async () => "base"),
}));
vi.mock("../walkthrough-context", () => ({
  useWalkthrough: () => ({ active: null, stepIndex: 0, currentStep: null, start: vi.fn(), next: vi.fn(), exit: vi.fn() }),
}));
vi.mock("../use-forge-import", () => ({
  useForgeImport: () => ({ status: "idle", errorMessage: null, runImport: vi.fn(), reset: vi.fn() }),
}));
vi.mock("@/domain/forge/help/videos", async () => {
  const f = await import("@/domain/forge/help/__tests__/help-video-fixtures");
  const all = [f.EXPENSE_VIDEO, f.SOLVER_VIDEO];
  return { HELP_VIDEOS: all, getHelpVideo: (s: string) => all.find((v) => v.slug === s) };
});

// jsdom has no element scrolling: spy on the chat's scroll-to-newest.
const scrollTo = vi.fn();
Element.prototype.scrollTo = scrollTo;

/** A stream the test feeds frame by frame, to land an answer at a chosen moment. */
function controlledStream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push: (frame: string) => ctl.enqueue(enc.encode(frame)),
    end: () => ctl.close(),
  };
}

function framed(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const mount = () =>
  render(
    <ScenarioDrawerProvider>
      <ForgeProvider clientId="c1">
        <ForgePanel clientId="c1" clientName="Mark & Laura Hendricks" scenarioNames={{ s1: "Base" }} forceOpenForTest />
      </ForgeProvider>
    </ScenarioDrawerProvider>,
  );
const tab = (name: string) => screen.getByRole("tab", { name });
const composer = () => screen.queryByRole("textbox", { name: /ask forge/i }) as HTMLTextAreaElement | null;
const ask = async (text: string) => {
  await act(async () => {
    fireEvent.change(composer()!, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Send message"));
  });
};
const EXPENSE_TITLE = "Add a one-time expense and see it in the cash flow";

let media: ReturnType<typeof stubMediaElements>;

beforeEach(() => {
  media = stubMediaElements();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(framed([`data: {"type":"done"}\n\n`])));
});

describe("ForgePanel — Chat | Knowledge Hub", () => {
  it("starts on Chat; the Hub is one click away and Chat keeps its draft", async () => {
    mount();
    expect(tab("Chat")).toHaveAttribute("aria-selected", "true");
    fireEvent.change(composer()!, { target: { value: "hello" } });
    fireEvent.click(tab("Knowledge Hub"));
    expect(tab("Knowledge Hub")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "Search help videos" })).toBeInTheDocument();
    expect(composer()).toBeNull(); // hidden, not unmounted
    fireEvent.click(tab("Chat"));
    expect(composer()!.value).toBe("hello");
  });

  it("arrow keys move between tabs", () => {
    mount();
    fireEvent.keyDown(tab("Chat"), { key: "ArrowRight" });
    expect(tab("Knowledge Hub")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Knowledge Hub"), { key: "ArrowLeft" });
    expect(tab("Chat")).toHaveAttribute("aria-selected", "true");
    // Focus stays on the tab so the next arrow press still switches tabs
    // (the composer's autofocus must not pull it into the textarea).
    expect(tab("Chat")).toHaveFocus();
  });

  it("shows For this screen for the page the advisor is on", () => {
    mount();
    fireEvent.click(tab("Knowledge Hub"));
    expect(screen.getByRole("region", { name: "For this screen" })).toHaveTextContent("Add a one-time expense");
  });

  it("Ask in Chat instead carries the search into the composer", () => {
    mount();
    fireEvent.click(tab("Knowledge Hub"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search help videos" }), { target: { value: "roth" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask in Chat instead" }));
    expect(tab("Chat")).toHaveAttribute("aria-selected", "true");
    expect(composer()!.value).toBe("roth");
  });

  it("a video_link frame renders a Watch card that opens the Hub at the chapter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        framed([
          `data: {"type":"token","text":"Here's how."}\n\n`,
          `data: {"type":"video_link","slug":"add-one-time-expense","title":"Add a one-time expense and see it in the cash flow","chapterAt":30,"chapterLabel":"Set the start and end year to 2028, so it's paid once."}\n\n`,
          `data: {"type":"video_link","slug":"add-one-time-expense","title":"Add a one-time expense and see it in the cash flow"}\n\n`,
          `data: {"type":"done"}\n\n`,
        ]),
      ),
    );
    const { container } = mount();
    await act(async () => {
      fireEvent.change(composer()!, { target: { value: "How do I add a one-time expense?" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send message"));
    });
    const cards = await screen.findAllByRole("button", { name: /watch: add a one-time expense/i });
    expect(cards).toHaveLength(1); // de-duped by slug
    expect(cards[0]).toHaveTextContent("0:30 · Set the start and end year");
    fireEvent.click(cards[0]);
    expect(tab("Knowledge Hub")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Add a one-time expense and see it in the cash flow" })).toBeInTheDocument();
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(30);
    // Back to Chat pauses the video without unmounting the Hub; returning
    // finds the same player at the same spot.
    fireEvent.click(tab("Chat"));
    expect(media.pause).toHaveBeenCalled();
    expect(video.isConnected).toBe(true);
    fireEvent.click(tab("Knowledge Hub"));
    expect(container.querySelector("video")).toBe(video);
    expect(video.currentTime).toBe(30);
  });

  it("clicking a Watch card moves focus into the Hub, onto the video's title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        framed([
          `data: {"type":"token","text":"Here's how."}\n\n`,
          `data: {"type":"video_link","slug":"add-one-time-expense","title":"${EXPENSE_TITLE}"}\n\n`,
          `data: {"type":"done"}\n\n`,
        ]),
      ),
    );
    mount();
    await ask("How do I add a one-time expense?");
    const card = await screen.findByRole("button", { name: /watch: add a one-time expense/i });
    act(() => card.focus());
    fireEvent.click(card);
    expect(screen.getByRole("tabpanel", { name: "Knowledge Hub" })).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("heading", { name: EXPENSE_TITLE })).toHaveFocus();
  });

  it("an answer that streamed while the Hub showed is scrolled into view on return to Chat", async () => {
    const stream = controlledStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream.response));
    mount();
    await ask("How do I add a one-time expense?");
    fireEvent.click(tab("Knowledge Hub"));
    await act(async () => {
      stream.push(`data: {"type":"token","text":"Here's how."}\n\n`);
      stream.push(`data: {"type":"done"}\n\n`);
      stream.end();
    });
    await screen.findByText(/Here's how\./);
    await act(async () => {});

    scrollTo.mockClear();
    fireEvent.click(tab("Chat"));
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "smooth" });

    // Nothing new since: another round trip leaves the advisor's scroll alone.
    fireEvent.click(tab("Knowledge Hub"));
    scrollTo.mockClear();
    fireEvent.click(tab("Chat"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("doesn't mount the Hub (or fetch posters) until it's first opened", () => {
    const { container } = mount();
    expect(container.querySelector("img")).toBeNull();
  });
});

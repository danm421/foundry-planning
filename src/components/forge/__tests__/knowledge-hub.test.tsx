// src/components/forge/__tests__/knowledge-hub.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EXPENSE_VIDEO, SOLVER_VIDEO } from "@/domain/forge/help/__tests__/help-video-fixtures";
import { stubMediaElements } from "./media-stubs";

const forge = vi.hoisted(() => ({
  pathname: "/clients/c1/overview",
  hubTarget: null as null | { slug: string; at?: number; nonce: number },
  askInChat: vi.fn(),
}));
vi.mock("../forge-provider", () => ({ useForge: () => forge }));

import { KnowledgeHub } from "../knowledge-hub";

const VIDEOS = [SOLVER_VIDEO, EXPENSE_VIDEO];
const mount = () => render(<KnowledgeHub active videos={VIDEOS} />);
const search = (q: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Search help videos" }), { target: { value: q } });

beforeEach(() => {
  stubMediaElements();
  forge.pathname = "/clients/c1/overview";
  forge.hubTarget = null;
  forge.askInChat.mockReset();
});

describe("KnowledgeHub", () => {
  it("lists all videos newest first, with length", () => {
    mount();
    const all = within(screen.getByRole("region", { name: "All videos" }));
    const titles = all.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(titles[0]).toContain(EXPENSE_VIDEO.title);
    expect(titles[0]).toContain("1:13");
    expect(titles[1]).toContain(SOLVER_VIDEO.title);
  });

  it("shows For this screen only when a video covers the current page", () => {
    mount();
    expect(screen.queryByRole("region", { name: "For this screen" })).toBeNull();
    forge.pathname = "/clients/c1/details/income-expenses";
    render(<KnowledgeHub active videos={VIDEOS} />);
    const here = within(screen.getByRole("region", { name: "For this screen" }));
    expect(here.getByText(EXPENSE_VIDEO.title)).toBeInTheDocument();
    expect(here.queryByText(SOLVER_VIDEO.title)).toBeNull();
  });

  it("shows the matching chapter on a search hit and opens the video there", () => {
    const { container } = mount();
    search("start and end year");
    fireEvent.click(screen.getByRole("button", { name: /0:30 · Set the start and end year/ }));
    expect(screen.getByRole("heading", { name: EXPENSE_VIDEO.title })).toBeInTheDocument();
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(30);
  });

  it("offers Chat when nothing matches", () => {
    mount();
    search("roth conversion");
    expect(screen.getByText("No videos match.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask in Chat instead" }));
    expect(forge.askInChat).toHaveBeenCalledWith("roth conversion");
  });

  it("treats a stopword-only query as no match rather than failing", () => {
    mount();
    search("how do I");
    expect(screen.getByText("No videos match.")).toBeInTheDocument();
  });

  it("opens the video a Watch card asked for", () => {
    const { rerender } = mount();
    forge.hubTarget = { slug: SOLVER_VIDEO.slug, at: 40, nonce: 1 };
    rerender(<KnowledgeHub active videos={VIDEOS} />);
    expect(screen.getByRole("heading", { name: SOLVER_VIDEO.title })).toBeInTheDocument();
  });

  it("says so when there are no videos yet", () => {
    render(<KnowledgeHub active videos={[]} />);
    expect(screen.getByText("No videos yet.")).toBeInTheDocument();
  });
});

// src/components/forge/__tests__/help-video-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpVideoView } from "../help-video-view";
import { EXPENSE_VIDEO } from "@/domain/forge/help/__tests__/help-video-fixtures";
import { stubMediaElements } from "./media-stubs";

let media: ReturnType<typeof stubMediaElements>;
beforeEach(() => {
  media = stubMediaElements();
});

const videoEl = (c: HTMLElement) => c.querySelector("video") as HTMLVideoElement;

describe("HelpVideoView", () => {
  it("shows the title, recording month, chapters and bolded steps", () => {
    render(<HelpVideoView video={EXPENSE_VIDEO} active onBack={() => {}} />);
    expect(screen.getByRole("heading", { name: EXPENSE_VIDEO.title })).toBeInTheDocument();
    expect(screen.getByText(/Recorded Oct 2026/)).toBeInTheDocument();
    // the time and label are sibling spans, so the accessible name has no space between them
    expect(screen.getByRole("button", { name: /0:30\s*Set the start and end year/ })).toBeInTheDocument();
    expect(screen.getByText("Open Inflows & Outflows.").tagName).toBe("STRONG");
    expect(screen.getByText(/grows with inflation/)).toBeInTheDocument();
  });

  it("starts at the requested chapter once the video's metadata loads", () => {
    const { container } = render(<HelpVideoView video={EXPENSE_VIDEO} startAt={30} active onBack={() => {}} />);
    fireEvent.loadedMetadata(videoEl(container));
    expect(videoEl(container).currentTime).toBe(30);
    expect(media.play).toHaveBeenCalled();
  });

  it("jumps when a chapter is clicked", () => {
    const { container } = render(<HelpVideoView video={EXPENSE_VIDEO} active onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /0:44\s*Open Cash Flow/ }));
    expect(videoEl(container).currentTime).toBe(44);
  });

  it("pauses when the Hub tab is hidden, keeping its place", () => {
    const { container, rerender } = render(<HelpVideoView video={EXPENSE_VIDEO} active onBack={() => {}} />);
    videoEl(container).currentTime = 12;
    rerender(<HelpVideoView video={EXPENSE_VIDEO} active={false} onBack={() => {}} />);
    expect(media.pause).toHaveBeenCalled();
    expect(videoEl(container).currentTime).toBe(12);
  });

  it("says the video can't play when it fails, and keeps the steps", () => {
    const { container } = render(<HelpVideoView video={EXPENSE_VIDEO} active onBack={() => {}} />);
    fireEvent.error(videoEl(container));
    expect(screen.getByRole("alert").textContent).toBe("This video can't play right now.");
    expect(screen.getByText("Open Inflows & Outflows.")).toBeInTheDocument();
  });

  it("Expand opens a large player from the current time", () => {
    const { container } = render(<HelpVideoView video={EXPENSE_VIDEO} active onBack={() => {}} />);
    videoEl(container).currentTime = 21;
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const videos = document.querySelectorAll("video");
    expect(videos.length).toBe(2);
    fireEvent.loadedMetadata(videos[1]);
    expect((videos[1] as HTMLVideoElement).currentTime).toBe(21);
  });

  it("goes back to the list", () => {
    let back = false;
    render(<HelpVideoView video={EXPENSE_VIDEO} active onBack={() => (back = true)} />);
    fireEvent.click(screen.getByRole("button", { name: "← All videos" }));
    expect(back).toBe(true);
  });
});

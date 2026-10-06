// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getHelpVideo } from "@/domain/forge/help/videos";
import { posterSrc, videoSrc } from "@/components/forge/help-video-format";
import { WelcomeVideoDialog } from "../welcome-video-dialog";

const video = getHelpVideo("add-first-household")!;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  global.fetch = fetchMock as unknown as typeof fetch;
  // jsdom implements no media playback.
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

function videoEl(): HTMLVideoElement {
  return screen.getByRole("dialog").querySelector("video")!;
}

function expectSeenRecordedOnce() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/onboarding/first-run");
  expect(init).toMatchObject({ method: "PATCH", keepalive: true });
  expect(JSON.parse(init.body)).toEqual({ action: "dismiss_welcome_video" });
}

describe("WelcomeVideoDialog", () => {
  it("welcomes the advisor with the add-first-household video", () => {
    render(<WelcomeVideoDialog video={video} />);

    expect(screen.getByRole("dialog", { name: "Welcome to Foundry" })).toBeTruthy();
    expect(videoEl().getAttribute("src")).toBe(videoSrc(video));
    expect(videoEl().getAttribute("poster")).toBe(posterSrc(video));
    expect(videoEl().autoplay).toBe(false);
  });

  it("plays from the play button, which then gets out of the way", () => {
    render(<WelcomeVideoDialog video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Play video" }));

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.play(videoEl());
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  });

  it("closes from the Dismiss button and remembers it was seen", () => {
    render(<WelcomeVideoDialog video={video} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expectSeenRecordedOnce();
  });

  it("treats Esc as dismissing too, recording it only once", () => {
    render(<WelcomeVideoDialog video={video} />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expectSeenRecordedOnce();
  });

  it("explains a video that cannot load and can still be dismissed", () => {
    render(<WelcomeVideoDialog video={video} />);

    fireEvent.error(videoEl());

    expect(screen.getByRole("alert").textContent).toMatch(/can.t play right now/i);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expectSeenRecordedOnce();
  });
});

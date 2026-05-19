import { describe, it, expect } from "vitest";
import { parseSseStream } from "../use-need-over-time";

describe("parseSseStream", () => {
  it("yields complete events and returns the trailing partial", () => {
    const buffer =
      "event: progress\ndata: {\"done\":1}\n\nevent: result\ndata: par";
    const it = parseSseStream(buffer);

    const first = it.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ event: "progress", data: '{"done":1}' });

    const second = it.next();
    expect(second.done).toBe(true);
    expect(second.value).toBe("event: result\ndata: par");
  });

  it("returns the whole buffer when no event boundary is present", () => {
    const it = parseSseStream("event: progress\ndata: {}");
    const first = it.next();
    expect(first.done).toBe(true);
    expect(first.value).toBe("event: progress\ndata: {}");
  });
});

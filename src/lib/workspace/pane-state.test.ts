import { describe, it, expect } from "vitest";
import { calendarPaneState } from "./pane-state";

describe("calendarPaneState", () => {
  it("no accounts → connect", () => {
    expect(calendarPaneState({ impersonating: false, accountCount: 0 })).toBe("connect");
  });

  it("one or more accounts → ready", () => {
    expect(calendarPaneState({ impersonating: false, accountCount: 1 })).toBe("ready");
    expect(calendarPaneState({ impersonating: false, accountCount: 5 })).toBe("ready");
  });

  it("(Review Focus 5) impersonating → impersonating, whatever the advisor has connected", () => {
    expect(calendarPaneState({ impersonating: true, accountCount: 0 })).toBe("impersonating");
    expect(calendarPaneState({ impersonating: true, accountCount: 3 })).toBe("impersonating");
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SubscriptionGuard reads cookies() only for dismissible banners; unpaid/paused
// are non-dismissible (urgent-red), so no cookie read happens on these paths.
import { SubscriptionGuard } from "@/components/subscription-guard";

async function renderState(state: Parameters<typeof SubscriptionGuard>[0]["state"]) {
  const el = await SubscriptionGuard({ state, isFounder: false });
  return el ? renderToStaticMarkup(el) : "";
}

describe("SubscriptionGuard new terminal states", () => {
  it("renders an urgent banner for unpaid", async () => {
    const html = await renderState({ kind: "unpaid" });
    expect(html).toContain("role=\"alert\"");
    expect(html.toLowerCase()).toContain("payment");
  });

  it("renders an urgent banner for paused", async () => {
    const html = await renderState({ kind: "paused" });
    expect(html).toContain("role=\"alert\"");
    expect(html.toLowerCase()).toContain("paused");
  });
});

describe("SubscriptionGuard comp_ended", () => {
  it("renders an urgent, undismissable banner pointing at checkout", async () => {
    const html = await renderState({ kind: "comp_ended" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("/settings/billing");
    expect(html).toContain("Subscribe");
  });

  it("carries no dismiss control — the banner IS the prompt", async () => {
    // A dismissed banner would leave the firm editing-blocked with nothing on
    // screen explaining why.
    const html = await renderState({ kind: "comp_ended" });
    expect(html.toLowerCase()).not.toContain("dismiss");
  });

  it("tells them their data is still readable rather than that they are locked out", async () => {
    const html = await renderState({ kind: "comp_ended" });
    expect(html.toLowerCase()).toContain("readable");
  });
});

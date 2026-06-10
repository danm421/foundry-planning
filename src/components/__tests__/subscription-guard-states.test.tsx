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

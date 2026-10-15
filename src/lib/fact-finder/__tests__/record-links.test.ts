// src/lib/fact-finder/__tests__/record-links.test.ts
import { describe, expect, it } from "vitest";
import { TAB_ROUTES, findEntity } from "@/domain/forge/detail-fields";
import { TARGET_KINDS } from "../change-set";
import { detailsHrefFor } from "../record-links";

describe("detailsHrefFor", () => {
  it("links every target to the Details page that shows it (the field map's tab)", () => {
    for (const target of TARGET_KINDS) {
      const tab = findEntity(target)?.tab;
      expect(tab, target).toBeDefined();
      const href = detailsHrefFor("c1", target);
      expect(href.startsWith(`/clients/c1/details/${TAB_ROUTES[tab!]}`), `${target} → ${href}`).toBe(true);
    }
  });

  it("sends tax rates to their tab on Assumptions and everything else to the page itself", () => {
    expect(detailsHrefFor("c1", "plan_settings_tax_rates")).toBe("/clients/c1/details/assumptions?tab=tax-rates");
    expect(detailsHrefFor("c9", "account")).toBe("/clients/c9/details/net-worth");
    expect(detailsHrefFor("c9", "will_bequest")).toBe("/clients/c9/details/wills");
    expect(detailsHrefFor("c9", "plan_observation")).toBe("/clients/c9/details/observations");
  });
});

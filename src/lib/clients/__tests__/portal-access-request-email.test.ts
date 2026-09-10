import { describe, it, expect } from "vitest";
import {
  buildPortalAccessRequestEmailHtml,
  PORTAL_ACCESS_REQUEST_SUBJECT,
} from "@/lib/clients/portal-access-request-email";

const LINK = "https://app.foundryplanning.com/portal/requests";

describe("portal access request email", () => {
  it("links to the authenticated requests screen", () => {
    expect(buildPortalAccessRequestEmailHtml({ link: LINK })).toContain(LINK);
  });

  it("carries NO firm or advisor name, and takes no argument to supply one", () => {
    // The builder takes no such arguments AT ALL — this asserts the shape of
    // the contract, not just the current template text. If someone widens the
    // signature to accept a firm name, this test is where they must argue for it.
    //
    // "household" is NOT asserted here: the spec bans firm/advisor/household
    // NAMES, not the generic nouns, and the content-free template below uses
    // "household" as a plain English word. That sentence is pinned verbatim
    // in the next test instead.
    const html = buildPortalAccessRequestEmailHtml({ link: LINK });
    expect(html).not.toMatch(/firm/i);
    expect(html).not.toMatch(/advisor/i);
    expect(buildPortalAccessRequestEmailHtml.length).toBe(1);
  });

  it("uses a content-free sentence, pinned verbatim, that names no one", () => {
    const html = buildPortalAccessRequestEmailHtml({ link: LINK });
    expect(html).toContain(
      "Someone has asked to connect your Foundry Planning account to a household.",
    );
  });

  it("uses a subject that reveals nothing about who is asking", () => {
    expect(PORTAL_ACCESS_REQUEST_SUBJECT).toBe(
      "You have a pending connection request on Foundry Planning",
    );
    expect(PORTAL_ACCESS_REQUEST_SUBJECT).not.toMatch(/firm|advisor|household/i);
  });

  it("escapes the link rather than interpolating it raw", () => {
    const html = buildPortalAccessRequestEmailHtml({
      link: 'https://app.foundryplanning.com/portal/requests?x="onload=alert(1)',
    });
    expect(html).not.toContain('"onload=');
    expect(html).toContain("&quot;onload=");
  });
});

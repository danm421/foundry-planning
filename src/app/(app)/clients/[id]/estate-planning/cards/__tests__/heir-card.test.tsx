// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HeirCard } from "../heir-card";
import type { HeirCardData } from "../../lib/derive-card-data";

const data: HeirCardData = {
  familyMemberId: "fm2",
  name: "Tom Jr Smith",
  relationship: "child",
  age: 31,
  bequestsReceived: [
    { bequestId: "b1", willId: "w1", willGrantor: "client", assetName: "401k", condition: "always", percentage: 50 },
  ],
};

describe("HeirCard", () => {
  it("renders collapsed with name and bequest count", () => {
    render(<HeirCard data={data} />);
    expect(screen.getByText("Tom Jr Smith")).toBeInTheDocument();
    expect(screen.getByText(/1 bequest/i)).toBeInTheDocument();
  });

  it("expands and shows bequest rows", () => {
    render(<HeirCard data={data} defaultExpanded />);
    expect(screen.getByText("401k")).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("renders an empty drop-zone hint when no bequests", () => {
    const empty: HeirCardData = { ...data, bequestsReceived: [] };
    render(<HeirCard data={empty} defaultExpanded />);
    expect(screen.getByText(/Drop assets to bequeath/i)).toBeInTheDocument();
  });

  it("renders the condition tag only for non-default conditions", () => {
    const conditional: HeirCardData = {
      ...data,
      bequestsReceived: [
        { bequestId: "b2", willId: "w1", willGrantor: "client", assetName: "House", condition: "if_spouse_predeceased", percentage: 100 },
      ],
    };
    render(<HeirCard data={conditional} defaultExpanded />);
    expect(screen.getByText(/if_spouse_predeceased/i)).toBeInTheDocument();
  });

  it("does NOT render the condition tag when condition is 'always' (the default)", () => {
    render(<HeirCard data={data} defaultExpanded />);
    expect(screen.queryByText(/always/i)).not.toBeInTheDocument();
  });
});

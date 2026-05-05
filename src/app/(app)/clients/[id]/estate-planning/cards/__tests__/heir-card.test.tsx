// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HeirCard } from "../heir-card";
import type { HeirCardData } from "../../lib/derive-card-data";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({
    isOver: false,
    setNodeRef: () => undefined,
  }),
}));

vi.mock("../../dnd-context-provider", () => ({
  useBequestEdit: () => ({ onEditBequest: vi.fn() }),
}));

const bequestOnly: HeirCardData = {
  familyMemberId: "fm2",
  name: "Tom Jr Smith",
  relationship: "child",
  age: 31,
  bequestsReceived: [
    { bequestId: "b1", willId: "w1", willGrantor: "client", assetName: "401k", condition: "always", percentage: 50 },
  ],
  ownershipRows: [],
  breach: false,
};

const ownershipOnly: HeirCardData = {
  familyMemberId: "fm3",
  name: "Sally Smith",
  relationship: "child",
  age: 28,
  bequestsReceived: [],
  ownershipRows: [
    {
      accountId: "a-utma",
      accountName: "UTMA for Sally",
      category: "taxable",
      taxTag: "TAX",
      ownerPercent: 1,
      sliceValue: 50_000,
      linkedLiabilityBalance: 0,
      netSliceValue: 50_000,
      hasMultipleOwners: false,
      coOwners: [],
    },
  ],
  breach: false,
};

const empty: HeirCardData = {
  familyMemberId: "fm4",
  name: "No-Assets Child",
  relationship: "child",
  age: 25,
  bequestsReceived: [],
  ownershipRows: [],
  breach: false,
};

describe("HeirCard", () => {
  it("renders collapsed with name and bequest count", () => {
    render(<HeirCard data={bequestOnly} />);
    expect(screen.getByText("Tom Jr Smith")).toBeInTheDocument();
    expect(screen.getByText(/1 bequest/i)).toBeInTheDocument();
  });

  it("expands and shows bequest rows", () => {
    render(<HeirCard data={bequestOnly} defaultExpanded />);
    expect(screen.getByText("401k")).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("renders bequest rows with grantor sub-line", () => {
    render(<HeirCard data={bequestOnly} defaultExpanded />);
    expect(screen.getByText(/On .* death/i)).toBeInTheDocument();
  });

  it("renders an empty state message when neither bequests nor ownership rows", () => {
    render(<HeirCard data={empty} defaultExpanded />);
    expect(screen.getByText(/No bequests or direct ownership yet/i)).toBeInTheDocument();
  });

  it("renders ownership rows when heir directly owns an asset", () => {
    render(<HeirCard data={ownershipOnly} defaultExpanded />);
    expect(screen.getByText("UTMA for Sally")).toBeInTheDocument();
  });

  it("renders the condition tag only for non-default conditions", () => {
    const conditional: HeirCardData = {
      ...bequestOnly,
      bequestsReceived: [
        { bequestId: "b2", willId: "w1", willGrantor: "client", assetName: "House", condition: "if_spouse_predeceased", percentage: 100 },
      ],
    };
    render(<HeirCard data={conditional} defaultExpanded />);
    expect(screen.getByText(/if_spouse_predeceased/i)).toBeInTheDocument();
  });

  it("does NOT render the condition tag when condition is 'always' (the default)", () => {
    render(<HeirCard data={bequestOnly} defaultExpanded />);
    expect(screen.queryByText(/always/i)).not.toBeInTheDocument();
  });
});

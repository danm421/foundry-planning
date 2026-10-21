// src/lib/integrations/providers/addepar/doc-replies.fixtures.ts
//
// Example replies copied from developers.addepar.com (pages updated 2026-09-23,
// read 2026-10-21). Each names its source page. They are the docs' examples,
// not captures from a live firm — no live Addepar key exists to record one.

/** Groups → "Get all groups" (GET /v1/groups), verbatim. */
export const GROUPS_GET_ALL = {
  data: [
    {
      type: "groups",
      id: "100",
      attributes: {
        name: "Group 1",
        created_at: "2023-07-28T02:24:30Z",
        modified_at: "2023-07-30T10:43:21Z",
      },
      relationships: {
        members: {
          links: {
            self: "/v1/groups/100/relationships/members",
            related: "/v1/groups/100/members",
          },
          data: [
            { type: "entities", id: "200" },
            { type: "entities", id: "204" },
            { type: "entities", id: "360" },
            { type: "entities", id: "486" },
          ],
        },
        group_type: {
          links: {
            self: "/v1/groups/100/relationships/group_type",
            related: "/v1/groups/100/group_type",
          },
          data: { type: "group_types", id: "GROUPS" },
        },
        child_groups: {
          links: {
            self: "/v1/groups/100/relationships/child_groups",
            related: "/v1/groups/100/child_groups",
          },
          data: [],
        },
      },
      links: { self: "/v1/groups/100" },
    },
    {
      type: "groups",
      id: "101",
      attributes: {
        name: "Group 2",
        created_at: "2023-07-28T02:24:30Z",
        modified_at: "2023-07-30T10:43:21Z",
      },
      relationships: {
        members: {
          links: {
            self: "/v1/groups/101/relationships/members",
            related: "/v1/groups/101/members",
          },
          data: [
            { type: "entities", id: "102" },
            { type: "entities", id: "289" },
            { type: "entities", id: "349" },
            { type: "entities", id: "438" },
          ],
        },
        group_type: {
          links: {
            self: "/v1/groups/101/relationships/group_type",
            related: "/v1/groups/101/group_type",
          },
          data: { type: "group_types", id: "HH_GROUPS" },
        },
        child_groups: {
          links: {
            self: "/v1/groups/101/relationships/child_groups",
            related: "/v1/groups/101/child_groups",
          },
          data: [{ type: "groups", id: "102" }],
        },
      },
      links: { self: "/v1/groups/101" },
    },
  ],
  included: [],
};

/** Groups → "Get a group's child groups", verbatim — a one-group page whose `links.next` is null. */
export const GROUPS_CHILD_GROUPS = {
  data: [
    {
      id: "92",
      type: "groups",
      attributes: {
        name: "Child Group",
        created_at: "2023-07-28T02:24:30Z",
        modified_at: "2023-07-30T10:43:21Z",
      },
      relationships: {
        members: {
          links: {
            self: "/v1/groups/92/relationships/members",
            related: "/v1/groups/92/members",
          },
          data: [{ type: "entities", id: "12" }],
        },
        child_groups: {
          links: {
            self: "/v1/groups/92/relationships/child_groups",
            related: "/v1/groups/92/child_groups",
          },
          data: [],
        },
        group_type: {
          links: {
            self: "/v1/groups/92/relationships/group_type",
            related: "/v1/groups/92/group_type",
          },
          data: { type: "group_types", id: "GROUPS" },
        },
      },
      links: { self: "/v1/groups/92" },
    },
  ],
  included: [],
  links: { next: null },
};

/** Pagination → the `links.next` example's form: a path under the API root. */
export const PAGINATION_NEXT = "/v1/groups?page[limit]=2000&page[after]=101";

/**
 * Portfolio → Query, "Filter Object" example (POST /v1/portfolio/query,
 * GROUP 9559, grouped by holding_account, cost_basis column), verbatim.
 * Accounts nest: "Adam Smith IRA" holds a Pershing account plus its own
 * "Directly Owned" remainder, and its figure includes both.
 */
export const PORTFOLIO_QUERY_COST_BASIS_BY_ACCOUNT = {
  meta: {
    columns: [
      {
        key: "cost_basis",
        display_name: "Original Cost Basis (USD)",
        output_type: "Number",
        currency: "USD",
      },
    ],
    groupings: [{ key: "holding_account", display_name: "Holding Account" }],
  },
  data: {
    type: "portfolio_views",
    attributes: {
      total: {
        name: "Total",
        columns: { cost_basis: 2.1105883993468016e7 },
        children: [
          {
            entity_id: 2260636,
            name: "Adam Smith IRA (786581)",
            grouping: "holding_account",
            columns: { cost_basis: 1255000.0 },
            children: [
              {
                entity_id: 2260640,
                name: "Pershing (DMA 859658)",
                grouping: "holding_account",
                columns: { cost_basis: 690000.0 },
                children: [],
              },
              {
                name: "Directly Owned",
                grouping: "holding_account",
                columns: { cost_basis: 565000.0 },
                children: [],
              },
            ],
          },
          {
            entity_id: 259885,
            name: "Manager A",
            grouping: "holding_account",
            columns: { cost_basis: 4516070.2846626425 },
            children: [
              {
                entity_id: 259825,
                name: "DJIA ETF 90",
                grouping: "holding_account",
                columns: { cost_basis: 367853.25000000006 },
                children: [],
              },
              {
                name: "Directly Owned",
                grouping: "holding_account",
                columns: { cost_basis: 4148217.034662644 },
                children: [],
              },
            ],
          },
          {
            entity_id: 260654,
            name: "Manager C",
            grouping: "holding_account",
            columns: { cost_basis: 3021140.808805371 },
            children: [],
          },
          {
            entity_id: 259875,
            name: "Manager I",
            grouping: "holding_account",
            columns: { cost_basis: 679996.67 },
            children: [],
          },
          {
            entity_id: 260737,
            name: "Manager K",
            grouping: "holding_account",
            columns: { cost_basis: 1283492.04 },
            children: [],
          },
          {
            entity_id: 260740,
            name: "Manager M",
            grouping: "holding_account",
            columns: { cost_basis: 2379993.2 },
            children: [],
          },
          {
            entity_id: 2260638,
            name: "Southern Trust Fixed Income SMA (600551984)",
            grouping: "holding_account",
            columns: { cost_basis: 7970190.99 },
            children: [],
          },
        ],
      },
    },
  },
  included: [],
};

/**
 * Portfolio → View, "Get Analysis View Data" example, verbatim: the same tree
 * shape a holding_account → position query returns. Both positions sit under
 * "Directly Owned" at the top — held by the household itself, in no account.
 */
export const PORTFOLIO_VIEW_DIRECTLY_OWNED = {
  meta: {
    columns: [{ key: "value", display_name: "Value (USD)", output_type: "Number", currency: "USD" }],
    groupings: [
      { key: "holding_account", display_name: "Holding Account" },
      { key: "position", display_name: "Position" },
    ],
  },
  data: {
    type: "portfolio_views",
    attributes: {
      total: {
        name: "Total",
        columns: { value: 1.037535456e7 },
        children: [
          {
            name: "Directly Owned",
            grouping: "holding_account",
            columns: { value: 1.037535456e7 },
            children: [
              {
                name: "Anchorage Illiquid Opportunities III Access Fund LP",
                grouping: "position",
                columns: { value: 1746188.0 },
                children: [],
              },
              {
                name: "GS Liquidity Partners 2007 LP",
                grouping: "position",
                columns: { value: 8629166.56 },
                children: [],
              },
            ],
          },
        ],
      },
    },
  },
  included: [],
};

/**
 * COMPOSED, not verbatim: no docs example has both groupings AND both columns.
 * This joins the account node of the Query "Filter Object" example with the
 * position nodes of the View example, and gives each node a value and a cost
 * basis. The positions' cost bases are made up for the test.
 */
export const PORTFOLIO_QUERY_ACCOUNT_WITH_POSITIONS = {
  meta: {
    columns: [
      { key: "value", display_name: "Value (USD)", output_type: "Number", currency: "USD" },
      { key: "cost_basis", display_name: "Original Cost Basis (USD)", output_type: "Number", currency: "USD" },
    ],
    groupings: [
      { key: "holding_account", display_name: "Holding Account" },
      { key: "position", display_name: "Position" },
    ],
  },
  data: {
    type: "portfolio_views",
    attributes: {
      total: {
        name: "Total",
        columns: { value: 1.037535456e7, cost_basis: 9000000.0 },
        children: [
          {
            entity_id: 2260636,
            name: "Adam Smith IRA (786581)",
            grouping: "holding_account",
            columns: { value: 1.037535456e7, cost_basis: 9000000.0 },
            children: [
              {
                name: "Anchorage Illiquid Opportunities III Access Fund LP",
                grouping: "position",
                columns: { value: 1746188.0, cost_basis: 1500000.0 },
                children: [],
              },
              {
                name: "GS Liquidity Partners 2007 LP",
                grouping: "position",
                columns: { value: 8629166.56, cost_basis: 7500000.0 },
                children: [],
              },
            ],
          },
        ],
      },
    },
  },
  included: [],
};

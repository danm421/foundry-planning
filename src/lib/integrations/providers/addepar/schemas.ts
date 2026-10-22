// src/lib/integrations/providers/addepar/schemas.ts
//
// Reply shapes from developers.addepar.com. Addepar speaks JSON:API; only the
// fields Foundry reads are parsed.
import { z } from "zod";

/** A page of GET /v1/groups (Groups; Pagination). `links` is absent on some replies. */
export const addeparGroupsPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), attributes: z.object({ name: z.string() }) })),
  links: z.object({ next: z.string().nullable() }).optional(),
});

/** A page of GET /v1/attributes (Attributes). */
export const addeparAttributesPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), attributes: z.object({ display_name: z.string().nullish() }) })),
  links: z.object({ next: z.string().nullable() }).optional(),
});

/** One row of a Portfolio Query tree: a grouping value with its column values. */
export type PortfolioNode = {
  entity_id?: number | null;
  name: string;
  grouping?: string;
  columns?: Record<string, unknown>;
  children?: PortfolioNode[];
};

const portfolioNodeSchema: z.ZodType<PortfolioNode> = z.lazy(() =>
  z.object({
    entity_id: z.number().nullish(),
    name: z.string(),
    grouping: z.string().optional(),
    columns: z.record(z.string(), z.unknown()).optional(),
    children: z.array(portfolioNodeSchema).optional(),
  }),
);

/** POST /v1/portfolio/query reply (Portfolio → Query). */
export const portfolioQueryReplySchema = z.object({
  data: z.object({ attributes: z.object({ total: portfolioNodeSchema }) }),
});

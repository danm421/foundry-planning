import { z } from "zod";
import { PRESENTATION_PAGES, type PresentationPageId } from "@/components/presentations/registry";

const pageIds = Object.keys(PRESENTATION_PAGES) as [PresentationPageId, ...PresentationPageId[]];

const descriptorVariants = pageIds.map((pid) =>
  z.object({
    pageId: z.literal(pid),
    options: PRESENTATION_PAGES[pid].optionsSchema,
  }),
);

export const templateDescriptorSchema =
  descriptorVariants.length === 1
    ? descriptorVariants[0]
    : z.discriminatedUnion("pageId", descriptorVariants as [
        (typeof descriptorVariants)[number],
        ...(typeof descriptorVariants)[number][],
      ]);

export const templatePagesSchema = z.array(templateDescriptorSchema).min(1);

export type TemplateDescriptor = z.infer<typeof templateDescriptorSchema>;

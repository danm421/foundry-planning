import { z } from "zod";
import type { ClientProfilePageOptions } from "./types";

// No per-instance options — empty object keeps registry plumbing uniform.
export const clientProfileOptionsSchema = z.object(
  {},
) satisfies z.ZodType<ClientProfilePageOptions>;

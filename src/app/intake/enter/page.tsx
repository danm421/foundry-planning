import type { ReactElement } from "react";
import { EnterClient } from "./enter-client";

export const dynamic = "force-dynamic";

export default async function IntakeEnterPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}): Promise<ReactElement> {
  const { ticket } = await searchParams;
  return <EnterClient ticket={ticket ?? null} />;
}

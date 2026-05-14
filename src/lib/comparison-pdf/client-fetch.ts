import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients } from "@/db/schema";

export interface ClientForExport {
  id: string;
  firmId: string;
  advisorId: string;
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export async function clientByIdInFirm(
  clientId: string,
  firmId: string,
): Promise<ClientForExport | null> {
  const [row] = await db
    .select({
      id: clients.id,
      firmId: clients.firmId,
      advisorId: clients.advisorId,
      firstName: clients.firstName,
      lastName: clients.lastName,
      spouseName: clients.spouseName,
      spouseLastName: clients.spouseLastName,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return row ?? null;
}

export async function resolveAdvisorName(advisorId: string): Promise<string> {
  try {
    const cc = await clerkClient();
    const advisor = await cc.users.getUser(advisorId);
    const fullName = [advisor.firstName, advisor.lastName].filter(Boolean).join(" ").trim();
    return fullName || advisor.emailAddresses?.[0]?.emailAddress || "Advisor";
  } catch {
    return "Advisor";
  }
}

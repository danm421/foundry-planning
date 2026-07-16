import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { LANDING_PATH } from "@/lib/routes";

export default async function HomePage() {
  const { userId, orgId } = await auth();
  if (userId && orgId) redirect(LANDING_PATH);
  redirect("/sign-in");
}

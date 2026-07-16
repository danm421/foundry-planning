import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function HomePage() {
  const { userId, orgId } = await auth();
  if (userId && orgId) redirect("/home");
  redirect("/sign-in");
}

import { redirect } from "next/navigation";

export default function PortalIndex(): never {
  redirect("/portal/profile");
}

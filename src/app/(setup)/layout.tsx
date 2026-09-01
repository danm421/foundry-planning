import { AuthChrome } from "@/components/auth-chrome";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <AuthChrome width="max-w-5xl">{children}</AuthChrome>;
}

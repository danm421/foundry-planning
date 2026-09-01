import { AuthChrome } from "@/components/auth-chrome";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthChrome>{children}</AuthChrome>;
}

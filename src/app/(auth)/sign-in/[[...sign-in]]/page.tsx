import { SignIn } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn forceRedirectUrl="/clients" appearance={{ baseTheme: dark }} />
    </div>
  );
}

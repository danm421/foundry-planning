import { SignUp } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp
        appearance={{
          baseTheme: dark,
          variables: { colorPrimaryForeground: "#000000" },
          elements: {
            formButtonPrimary: "text-black",
          },
        }}
      />
    </div>
  );
}

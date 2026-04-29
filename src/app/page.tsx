import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-100">
          Foundry Planning
        </h1>
        <p className="mt-4 text-lg text-gray-300">
          Cash flow-based financial planning for advisors
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <Link
            href="/sign-in"
            className="rounded-md bg-accent px-6 py-3 text-sm font-semibold text-accent-on hover:bg-accent-deep"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-100 hover:bg-gray-800"
          >
            Sign Up
          </Link>
        </div>
      </div>
    </div>
  );
}

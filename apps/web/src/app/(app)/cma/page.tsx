import CmaClient from "./cma-client";

export default function CmaPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Capital Market Assumptions</h1>
        <p className="mt-1 text-sm text-gray-400">
          Manage asset classes and model portfolios used across all client plans.
        </p>
      </div>
      <CmaClient />
    </div>
  );
}

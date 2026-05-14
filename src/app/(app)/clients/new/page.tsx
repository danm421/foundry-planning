import QuickCreateForm from "./quick-create-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="mb-2 text-2xl font-semibold text-gray-100">New client</h1>
      <p className="mb-6 text-sm text-gray-400">
        We&apos;ll set up a guided walkthrough for the rest. You can change everything later.
      </p>
      <QuickCreateForm />
    </div>
  );
}

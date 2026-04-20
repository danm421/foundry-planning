import { OrganizationList } from "@clerk/nextjs";

// Landing page signed-in users hit when they have no active Clerk org.
// Without this, requireOrgId() would 401 them on every API route and
// the app would dead-end with no UX for picking or creating an org.
// Middleware forces a redirect here so no downstream route has to
// handle the orgless case.
export default function SelectOrganizationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Choose an organization</h1>
          <p className="mt-2 text-sm text-gray-600">
            Foundry Planning is scoped by firm. Pick an organization to continue
            or create a new one.
          </p>
        </div>
        <OrganizationList
          afterCreateOrganizationUrl="/clients"
          afterSelectOrganizationUrl="/clients"
          hidePersonal
          skipInvitationScreen
        />
      </div>
    </div>
  );
}

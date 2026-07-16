import { Suspense } from "react";
import type { ReactElement } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { listRecentlyOpenedHouseholds } from "@/lib/crm/households";
import { getBookKpis } from "@/lib/home/kpis";
import { getHomeFeed } from "@/lib/home/feed-sources";
import type { RecentHousehold } from "@/lib/home/types";
import { WelcomeBanner } from "./_components/welcome-banner";
import { KpiRow } from "./_components/kpi-row";
import { HomeFeedCard } from "./_components/home-feed";
import { RecentHouseholds } from "./_components/recent-households";
import { Card } from "@/components/card";
import { SkeletonText } from "@/components/skeleton";

async function FeedSection({
  firmId,
  userId,
  orgRole,
}: {
  firmId: string;
  userId: string;
  orgRole: string | null | undefined;
}): Promise<ReactElement> {
  const feed = await getHomeFeed(firmId, userId, orgRole, new Date());
  return <HomeFeedCard feed={feed} />;
}

export default async function HomePage(): Promise<ReactElement> {
  const { orgId, userId } = await requireOrgAndUser();
  const [{ orgRole }, user] = await Promise.all([auth(), currentUser()]);
  const today = new Date();

  // Section-level degradation: a failing helper blanks its section only.
  const [kpis, recentRows] = await Promise.all([
    getBookKpis(orgId, userId, orgRole, today).catch(() => null),
    listRecentlyOpenedHouseholds({ userId, limit: 8 }).catch(() => []),
  ]);

  const recent: RecentHousehold[] = recentRows.map((h) => ({
    id: h.id,
    name: h.name,
    status: h.status,
    hasPlanningClient: h.planningClient != null,
    lastOpenedAt: h.lastOpenedAt,
  }));

  return (
    <div className="flex flex-col gap-4 p-[var(--pad-card)]">
      <WelcomeBanner firstName={user?.firstName ?? null} />
      <KpiRow kpis={kpis} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense
            fallback={
              <Card className="px-[var(--pad-card)] py-4">
                <SkeletonText lines={6} />
              </Card>
            }
          >
            <FeedSection firmId={orgId} userId={userId} orgRole={orgRole} />
          </Suspense>
        </div>
        <RecentHouseholds households={recent} />
      </div>
    </div>
  );
}
